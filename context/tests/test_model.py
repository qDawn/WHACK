import io
import json
import os
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from bridge.model import (
    DIAGNOSTIC_STAGES,
    INSTRUCTIONS_PATH,
    ModelAdvisor,
    ModelError,
    ModelReport,
    card_for_miss,
    chat_url,
    load_instructions,
    missing_openai_key,
    model_settings,
    parse_choice,
    prompt_for,
    suggest,
)
from bridge.rules import first_match
from bridge.state_snapshot import to_state_snapshot
from context.core.models import ContextSnapshot


ENTRIES = [
    {"id": "open_godot", "title": "Godot", "detail": "${godotProject}"},
    {"id": "open_terminal", "title": "Terminal", "detail": "${gitRepo}"},
    {"id": "focus_discord", "title": "Discord", "detail": "Discord"},
]

CONFIG = {
    "godotProject": "C:/games/platformer/project.godot",
    "gitRepo": "C:/code/platformer",
    "model": {
        "baseUrl": "http://127.0.0.1:9/v1",
        "apiKey": "secret-key",
        "name": "demo",
        "timeoutMs": 8000,
    },
}


def snapshot(note: str) -> ContextSnapshot:
    return ContextSnapshot(note_body=note, clipboard_enabled=True, clipboard_text="copied")


class ModelTests(unittest.TestCase):
    def test_openai_key_comes_from_the_environment_or_a_secrets_file(self) -> None:
        openai = {
            "model": {
                "baseUrl": "https://api.openai.com/v1",
                "name": "gpt-4o-mini",
                "apiKey": "",
            }
        }
        missing = Path("does-not-exist-aura-secrets.json")
        with patch.dict(os.environ, {"AURA_OPENAI_API_KEY": ""}):
            self.assertIsNone(model_settings(openai, missing))
            self.assertTrue(missing_openai_key(openai, missing))
            self.assertEqual(model_settings(CONFIG, missing)["api_key"], "secret-key")

        with tempfile.TemporaryDirectory() as folder:
            secrets = Path(folder) / "aura.secrets.json"
            secrets.write_text(json.dumps({"apiKey": "sk-file"}), encoding="utf-8")
            with patch.dict(os.environ, {"AURA_OPENAI_API_KEY": ""}):
                settings = model_settings(openai, secrets)
            assert settings is not None
            self.assertEqual(settings["api_key"], "sk-file")
            self.assertFalse(missing_openai_key(openai, secrets))
            with patch.dict(os.environ, {"AURA_OPENAI_API_KEY": "sk-env"}):
                self.assertEqual(model_settings(openai, secrets)["api_key"], "sk-env")

    def test_empty_model_config_stays_offline(self) -> None:
        self.assertIsNone(model_settings({"model": {"baseUrl": "", "name": ""}}))
        called = False

        def post(settings, payload):
            nonlocal called
            called = True
            return "open_godot"

        self.assertIsNone(suggest(snapshot("hello"), ENTRIES, {"model": {}}, post))
        self.assertFalse(called)

    def test_chat_url_appends_the_completions_path_once(self) -> None:
        self.assertEqual(chat_url("http://localhost:11434/v1"), "http://localhost:11434/v1/chat/completions")
        self.assertEqual(
            chat_url("http://localhost:11434/v1/chat/completions/"),
            "http://localhost:11434/v1/chat/completions",
        )

    def test_choice_must_be_one_catalog_id(self) -> None:
        allowed = {"open_godot", "open_terminal", "focus_discord"}
        self.assertEqual(parse_choice("open_terminal", allowed), "open_terminal")
        self.assertIsNone(parse_choice("none", allowed))
        self.assertIsNone(parse_choice("open_terminal or focus_discord", allowed))
        self.assertIsNone(parse_choice("open_browser", allowed))

    def test_disabled_clipboard_is_left_out_of_the_prompt(self) -> None:
        hidden = ContextSnapshot(clipboard_enabled=False, clipboard_text="secret token", note_body="hello")
        text = prompt_for(hidden, ENTRIES)
        self.assertNotIn("secret token", text)
        self.assertIn("clipboard: disabled", text)

    def test_suggest_sends_the_instructions_and_the_focus_history(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            instructions = Path(folder) / "model_instructions.md"
            instructions.write_text("Reply with one id from the apps list, or none.", encoding="utf-8")
            seen: dict[str, str] = {}

            def post(settings, payload):
                seen["system"] = payload["messages"][0]["content"]
                seen["user"] = payload["messages"][1]["content"]
                return "open_godot"

            history = {
                "recent": [
                    {
                        "process_name": "Code.exe",
                        "window_title": "main.py",
                        "started_at": "2026-11-07T18:00:00Z",
                        "duration_ms": 5000,
                    }
                ],
                "frequent": [
                    {
                        "process_name": "Code.exe",
                        "focus_count": 2,
                        "total_ms": 9000,
                        "last_seen": "2026-11-07T18:00:00Z",
                    }
                ],
            }
            suggestion = suggest(
                snapshot("unrelated note"),
                ENTRIES,
                CONFIG,
                post,
                history=history,
                instructions_path=instructions,
            )

        assert suggestion is not None
        self.assertEqual(suggestion["kind"], "open_godot")
        self.assertIn("recent app history", suggestion["reason"])
        self.assertEqual(seen["system"], "Reply with one id from the apps list, or none.")
        self.assertIn("Code.exe | main.py | 5s", seen["user"])
        self.assertIn("Code.exe | visits 2 | 9s", seen["user"])
        self.assertNotIn("secret-key", seen["user"])
        self.assertIn("Reply with one id", load_instructions())
        self.assertTrue(INSTRUCTIONS_PATH.is_file())

    def test_suggest_accepts_only_a_catalog_id(self) -> None:
        def post(settings, payload):
            self.assertEqual(settings["name"], "demo")
            self.assertNotIn("secret-key", payload["messages"][1]["content"])
            self.assertEqual(payload["temperature"], 0)
            return "focus_discord"

        suggestion = suggest(snapshot("unrelated note"), ENTRIES, CONFIG, post)
        self.assertIsNotNone(suggestion)
        assert suggestion is not None
        self.assertEqual(suggestion["kind"], "focus_discord")
        self.assertEqual(suggestion["source"], "model")
        self.assertEqual(suggestion["detail"], "Discord")

    def test_advisor_uses_the_latest_miss_and_remembers_it(self) -> None:
        calls: list[str] = []
        results: list[str | None] = []

        def fake_suggest(current, entries, config, report=None):
            calls.append(current.note_body)
            return {"kind": "focus_discord", "title": "Discord", "detail": "Discord", "reason": "model", "source": "model"}

        def on_result(current, suggestion):
            results.append(None if suggestion is None else suggestion["kind"])

        advisor = ModelAdvisor(CONFIG, ENTRIES, on_result, fake_suggest, debounce_s=0.05)
        advisor.start()
        try:
            advisor.consider(snapshot("first"))
            advisor.consider(snapshot("second"))
            self.assertTrue(_wait_for(lambda: results == ["focus_discord"]))
            self.assertEqual(calls, ["second"])
            advisor.consider(snapshot("second"))
            self.assertTrue(_wait_for(lambda: results == ["focus_discord", "focus_discord"]))
            self.assertEqual(calls, ["second"])
        finally:
            advisor.stop()

    def test_advisor_drops_a_reply_after_a_rule_match(self) -> None:
        started = threading.Event()
        release = threading.Event()
        results: list[str | None] = []

        def fake_suggest(current, entries, config, report=None):
            started.set()
            release.wait(1)
            return {"kind": "open_godot", "title": "Godot", "detail": "project", "reason": "model", "source": "model"}

        advisor = ModelAdvisor(
            CONFIG,
            ENTRIES,
            lambda current, suggestion: results.append(None if suggestion is None else suggestion["kind"]),
            fake_suggest,
            debounce_s=0.01,
        )
        advisor.start()
        try:
            advisor.consider(snapshot("miss"))
            self.assertTrue(started.wait(1))
            advisor.cancel()
            release.set()
            time.sleep(0.1)
            self.assertEqual(results, [])
        finally:
            advisor.stop()

    def test_missing_key_stays_offline_and_leaves_rules_and_history(self) -> None:
        openai = {
            "model": {
                "baseUrl": "https://api.openai.com/v1",
                "name": "gpt-4o-mini",
                "apiKey": "",
            }
        }
        missing = Path("does-not-exist-aura-secrets.json")
        called = False

        def post(settings, payload):
            nonlocal called
            called = True
            return "open_godot"

        history_card = {
            "kind": "open_godot",
            "title": "Godot",
            "detail": "project",
            "reason": "From your recent apps.",
            "source": "history",
        }
        with patch.dict(os.environ, {"AURA_OPENAI_API_KEY": ""}):
            report = ModelReport(log=False)
            report.configure(openai, missing)
            availability = report.public()["availability"]
            self.assertIn(availability["status"], {"error", "skipped"})
            self.assertFalse(availability["keyPresent"])
            self.assertEqual(availability["host"], "api.openai.com")
            self.assertEqual(availability["model"], "gpt-4o-mini")
            self.assertNotIn("apiKey", json.dumps(report.public()))
            self.assertIsNone(model_settings(openai, missing))
            self.assertIsNone(
                suggest(snapshot("hello"), ENTRIES, openai, post, secrets_path=missing, report=report)
            )
        self.assertFalse(called)
        self.assertEqual(card_for_miss(history_card, None, failed=True), history_card)
        matched = first_match(
            ContextSnapshot(note_body="platformer"),
            {
                "rules": [
                    {
                        "id": "godot-from-note",
                        "when": {"noteContains": "platformer"},
                        "suggest": {
                            "kind": "open_godot",
                            "title": "Open the Godot project",
                            "target": "${godotProject}",
                        },
                    }
                ]
            },
            {"godotProject": "C:/games/platformer/project.godot"},
        )
        assert matched is not None
        self.assertEqual(matched["kind"], "open_godot")
        self.assertEqual(matched["source"], "rule")

    def test_failed_attempt_keeps_the_last_model_card_and_does_not_retry(self) -> None:
        calls: list[str] = []
        results: list[str | None] = []
        failures: list[str] = []
        history_card = {
            "kind": "open_terminal",
            "title": "Terminal",
            "detail": "repo",
            "reason": "From your recent apps.",
            "source": "history",
        }

        def fake_suggest(current, entries, config, report=None):
            calls.append(current.note_body)
            if current.note_body != "good":
                if report is not None:
                    report.fail_attempt("HTTP 500", "requestDelivery")
                raise ModelError("HTTP 500")
            return {
                "kind": "open_godot",
                "title": "Godot",
                "detail": "project",
                "reason": "model",
                "source": "model",
            }

        advisor = ModelAdvisor(
            CONFIG,
            ENTRIES,
            lambda current, suggestion: results.append(None if suggestion is None else suggestion["kind"]),
            fake_suggest,
            debounce_s=0.01,
            on_failure=lambda current, message: failures.append(message),
            report=ModelReport(log=False),
        )
        advisor.start()
        try:
            advisor.consider(snapshot("good"))
            self.assertTrue(_wait_for(lambda: results == ["open_godot"]))
            advisor.consider(snapshot("bad"))
            self.assertTrue(_wait_for(lambda: calls == ["good", "bad"] and len(failures) == 1))
            self.assertEqual(advisor.last_success()["kind"], "open_godot")
            self.assertEqual(card_for_miss(history_card, advisor.last_success(), failed=True)["kind"], "open_godot")
            self.assertEqual(advisor._report.public()["lastError"]["status"], "error")
            self.assertNotIn("secret-key", json.dumps(advisor._report.public()))
            advisor.consider(snapshot("bad"))
            time.sleep(0.12)
            self.assertEqual(calls, ["good", "bad"])
            advisor.consider(snapshot("later"))
            self.assertTrue(_wait_for(lambda: calls == ["good", "bad", "later"]))
        finally:
            advisor.stop()

        self.assertEqual(card_for_miss(history_card, None, failed=True)["source"], "history")

        def reject(settings, payload):
            raise ModelError("Reply was not a chat completion", stage="responseRetrieval")

        parse_report = ModelReport(log=False)
        with self.assertRaises(ModelError):
            suggest(snapshot("unrelated note"), ENTRIES, CONFIG, reject, report=parse_report)
        self.assertEqual(parse_report.public()["requestDelivery"]["status"], "ok")
        self.assertEqual(parse_report.public()["responseRetrieval"]["status"], "error")
        self.assertEqual(parse_report.public()["lastError"]["status"], "error")
        self.assertEqual(
            card_for_miss(history_card, {"kind": "open_godot", "title": "Godot", "detail": "project", "reason": "model", "source": "model"}, failed=True)["source"],
            "model",
        )

    def test_closed_port_fails_without_leaking_the_prompt(self) -> None:
        note = "NOTEBODY-TOKEN-9481"
        clip = "CLIPBOARD-TOKEN-9481"
        title = "WINDOWTITLE-TOKEN-9481"
        current = ContextSnapshot(
            note_body=note,
            clipboard_enabled=True,
            clipboard_text=clip,
            process_name="Code.exe",
            window_title=title,
        )
        report = ModelReport(log=True)
        captured = io.StringIO()
        with redirect_stdout(captured):
            with self.assertRaises(ModelError):
                suggest(current, ENTRIES, CONFIG, report=report)
        logged = captured.getvalue()
        diagnostics = json.dumps(report.public())
        self.assertEqual(report.public()["requestDelivery"]["status"], "error")
        self.assertEqual(report.public()["inferenceCompletion"]["status"], "skipped")
        self.assertNotIn("secret-key", logged)
        self.assertNotIn("secret-key", diagnostics)
        self.assertNotIn(note, logged)
        self.assertNotIn(note, diagnostics)
        self.assertNotIn(clip, logged)
        self.assertNotIn(clip, diagnostics)
        self.assertNotIn(title, diagnostics)
        self.assertIn("Code.exe", diagnostics)
        self.assertEqual(report.public()["contextSupplied"]["noteLength"], len(note))
        self.assertEqual(report.public()["contextSupplied"]["clipboardLength"], len(clip))
        self.assertTrue(report.public()["contextSupplied"]["windowTitlePresent"])

    def test_successful_fake_reply_updates_the_suggestion_and_diagnostics(self) -> None:
        report = ModelReport(log=False)

        def post(settings, payload):
            return "focus_discord"

        suggestion = suggest(snapshot("unrelated note"), ENTRIES, CONFIG, post, report=report)
        assert suggestion is not None
        self.assertEqual(suggestion["kind"], "focus_discord")
        self.assertEqual(suggestion["source"], "model")
        self.assertEqual(report.public()["inferenceCompletion"]["status"], "ok")
        self.assertEqual(report.public()["responseRetrieval"]["status"], "ok")
        history_card = {
            "kind": "open_godot",
            "title": "Godot",
            "detail": "project",
            "reason": "From your recent apps.",
            "source": "history",
        }
        shown = card_for_miss(history_card, None, model_card=suggestion)
        assert shown is not None
        self.assertEqual(shown["kind"], "focus_discord")
        message = to_state_snapshot(snapshot("unrelated note"), shown, diagnostics=report.public())
        self.assertEqual(message["payload"]["suggestion"]["kind"], "focus_discord")
        self.assertEqual(message["payload"]["diagnostics"]["inferenceCompletion"]["status"], "ok")
        self.assertEqual(message["payload"]["diagnostics"]["responseRetrieval"]["status"], "ok")
        self.assertEqual(message["payload"]["diagnostics"]["frontendDelivery"]["status"], "ok")

    def test_snapshot_diagnostics_omit_secrets_that_the_hud_already_receives(self) -> None:
        note = "NOTEBODY-TOKEN-9481"
        clip = "CLIPBOARD-TOKEN-9481"
        title = "WINDOWTITLE-TOKEN-9481"
        current = ContextSnapshot(
            note_body=note,
            clipboard_enabled=True,
            clipboard_text=clip,
            process_name="Code.exe",
            window_title=title,
        )
        report = ModelReport(log=False)

        def post(settings, payload):
            self.assertIn(note, payload["messages"][1]["content"])
            self.assertIn(clip, payload["messages"][1]["content"])
            self.assertNotIn("secret-key", payload["messages"][1]["content"])
            return "open_terminal"

        suggestion = suggest(current, ENTRIES, CONFIG, post, report=report)
        message = to_state_snapshot(current, suggestion, diagnostics=report.public())
        self.assertEqual(message["payload"]["noteBody"], note)
        self.assertEqual(message["payload"]["title"], title)
        diagnostics = json.dumps(message["payload"]["diagnostics"])
        self.assertNotIn(note, diagnostics)
        self.assertNotIn(clip, diagnostics)
        self.assertNotIn("secret-key", diagnostics)
        self.assertNotIn(title, diagnostics)
        self.assertNotIn("secret-key", json.dumps(message))
        self.assertNotIn(clip, json.dumps(message))
        for name in DIAGNOSTIC_STAGES:
            self.assertIn(name, message["payload"]["diagnostics"])
        self.assertEqual(message["payload"]["diagnostics"]["availability"]["keyPresent"], True)
        self.assertEqual(message["payload"]["diagnostics"]["availability"]["host"], "127.0.0.1")
        self.assertNotIn("/v1", json.dumps(message["payload"]["diagnostics"]["availability"]))


def _wait_for(check) -> bool:
    deadline = time.time() + 2
    while time.time() < deadline:
        if check():
            return True
        time.sleep(0.02)
    return False


if __name__ == "__main__":
    unittest.main()
