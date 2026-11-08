import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from bridge.model import (
    INSTRUCTIONS_PATH,
    ModelAdvisor,
    chat_url,
    load_instructions,
    missing_openai_key,
    model_settings,
    parse_choice,
    prompt_for,
    suggest,
)
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

        def fake_suggest(current, entries, config):
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

        def fake_suggest(current, entries, config):
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


def _wait_for(check) -> bool:
    deadline = time.time() + 2
    while time.time() < deadline:
        if check():
            return True
        time.sleep(0.02)
    return False


if __name__ == "__main__":
    unittest.main()
