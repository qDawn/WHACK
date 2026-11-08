"""Watch the scratchpad, match rules, and open the card the dashboard chooses."""

import json
import threading
from pathlib import Path

from bridge.launch import cards, load_entries, parse_action, perform
from bridge.model import ModelAdvisor, ModelReport, card_for_miss, missing_openai_key, model_settings, suggest
from bridge.pipe_server import serve, serve_actions
from bridge.rank import top_cards
from bridge.rules import first_match, load_json, project_paths
from bridge.state_snapshot import to_state_snapshot
from context.collectors.active_window import ActiveWindowCollector
from context.collectors.clipboard import ClipboardCollector
from context.collectors.scratchpad import ScratchpadCollector
from context.core.events import ContextEvent
from context.core.manager import HUD_EVENT_TYPES, ContextManager
from context.core.models import ContextSnapshot
from memory.focus_store import FocusStore, history_path


class Outbox:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._snapshot: str | None = None
        self._controls: list[str] = []

    def set_snapshot(self, line: str) -> None:
        with self._lock:
            self._snapshot = line

    def snapshot(self) -> str | None:
        with self._lock:
            return self._snapshot

    def push(self, line: str) -> None:
        with self._lock:
            self._controls.append(line)

    def drain(self) -> list[str]:
        with self._lock:
            pending = self._controls
            self._controls = []
            return pending


def open_history(config: dict) -> FocusStore | None:
    try:
        return FocusStore(history_path(config))
    except Exception as exc:
        print(f"History database unavailable: {exc}", flush=True)
        return None


def accept_action(
    line: str,
    entries: list,
    config: dict,
    url: str,
    perform_fn=perform,
    on_shown=None,
) -> str:
    """Launch one catalog action. ``hud.shown`` is not a launch."""

    try:
        parsed = json.loads(line)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict) and parsed.get("type") == "hud.shown":
        if on_shown is not None:
            on_shown()
        return "shown"
    if isinstance(parsed, dict) and parsed.get("kind") == "open_url":
        perform_fn("open_url", config, entries, target=url)
        return "open_url"
    kind = parse_action(line, entries)
    perform_fn(kind, config, entries)
    return kind


def read_process_history(store: FocusStore | None) -> dict[str, list]:
    """The compact history the model may see. A read error leaves the history empty."""

    if store is None:
        return {"recent": [], "frequent": []}
    try:
        return store.get_process_history()
    except Exception:
        print("History read failed", flush=True)
        return {"recent": [], "frequent": []}


def remember_window(store: FocusStore | None, event: ContextEvent) -> None:
    """Record a foreground app. A database error must not stop collection."""

    if store is None or event.event_type != "active_window_changed":
        return
    try:
        store.record_window(
            str(event.data.get("process_name") or ""),
            str(event.data.get("window_title") or ""),
            event.timestamp,
        )
    except Exception:
        print("History write failed", flush=True)


def main() -> None:
    config_path, rules_path = project_paths()
    config = load_json(config_path)
    rules = load_json(rules_path)
    note_path = Path(str(config["scratchpadPath"]))
    clipboard_enabled = bool(config.get("clipboardEnabled", True))
    manager = ContextManager(clipboard_enabled=clipboard_enabled)
    outbox = Outbox()
    entries = load_entries()
    actions = cards(entries, config)
    url_lock = threading.Lock()
    matched_url = {"value": ""}
    history_holder: dict[str, FocusStore | None] = {"store": None}
    report = ModelReport()
    report.configure(config)
    advisor: ModelAdvisor | None = None

    def publish_match(
        current: ContextSnapshot,
        suggestion: dict[str, str] | None,
        shown: list[dict[str, str]],
    ) -> None:
        report.set("frontendDelivery", "ok", "Snapshot published")
        message = to_state_snapshot(
            current,
            suggestion,
            actions=shown,
            diagnostics=report.public(),
        )
        outbox.set_snapshot(json.dumps(message, ensure_ascii=False))

    def publish_miss(
        snapshot: ContextSnapshot,
        *,
        failed: bool = False,
        model_card: dict[str, str] | None = None,
    ) -> None:
        history = read_process_history(history_holder["store"])
        ranked = top_cards(actions, None, history, limit=8)
        history_suggestion = None
        if ranked:
            history_suggestion = {
                "kind": ranked[0]["kind"],
                "title": ranked[0]["title"],
                "detail": ranked[0]["detail"],
                "reason": "From your recent apps.",
                "source": "history",
            }
        held = advisor.last_success() if advisor is not None else None
        suggestion = card_for_miss(
            history_suggestion,
            held,
            failed=failed,
            model_card=model_card,
        )
        publish_match(snapshot, suggestion, top_cards(actions, suggestion, history, limit=8))

    def on_model(snapshot: ContextSnapshot, suggestion: dict[str, str] | None) -> None:
        if suggestion is None:
            print("Model chose none", flush=True)
            publish_miss(snapshot)
            return
        publish_miss(snapshot, model_card=suggestion)
        print(f"Suggested {suggestion['kind']} from model", flush=True)

    def on_failure(snapshot: ContextSnapshot, _message: str) -> None:
        publish_miss(snapshot, failed=True)

    def suggest_from_history(
        snapshot: ContextSnapshot,
        catalog: list[dict],
        current_config: dict,
        report: ModelReport | None = None,
    ) -> dict[str, str] | None:
        return suggest(
            snapshot,
            catalog,
            current_config,
            history=read_process_history(history_holder["store"]),
            report=report,
        )

    def consider_snapshot(snapshot: ContextSnapshot) -> None:
        suggestion = first_match(snapshot, rules, config)
        history = read_process_history(history_holder["store"])
        shown = actions
        url = ""
        if suggestion is not None and suggestion.get("kind") == "open_url":
            url = suggestion.get("target", "")
            shown = [
                *actions,
                {
                    "kind": "open_url",
                    "title": suggestion.get("title", "Open this website"),
                    "detail": suggestion.get("detail", url),
                },
            ]
        with url_lock:
            matched_url["value"] = url
        if suggestion is not None:
            report.rule_matched()
            if advisor is not None:
                advisor.cancel()
            publish_match(snapshot, suggestion, top_cards(shown, suggestion, history, limit=8))
            print(f"Suggested {suggestion['kind']}", flush=True)
            return
        publish_miss(snapshot)
        print("No rule matched", flush=True)
        if advisor is not None:
            advisor.consider(snapshot)

    def consider_shown() -> None:
        consider_snapshot(manager.snapshot())

    def on_action(line: str) -> None:
        requested_kind: str | None = None
        resolved_kind: str | None = None
        try:
            try:
                preview = json.loads(line)
            except json.JSONDecodeError:
                preview = None
            if isinstance(preview, dict) and isinstance(preview.get("kind"), str):
                requested_kind = preview["kind"]
            with url_lock:
                url = matched_url["value"]
            resolved_kind = accept_action(line, entries, config, url, perform, consider_shown)
            if resolved_kind == "shown":
                return
        except Exception as exc:
            print(f"Open failed: {exc}", flush=True)
            error_line: dict[str, str] = {
                "protocol": "aura",
                "type": "hud.error",
                "message": str(exc),
            }
            error_kind = resolved_kind if isinstance(resolved_kind, str) else requested_kind
            if isinstance(error_kind, str):
                error_line["kind"] = error_kind
            outbox.push(json.dumps(error_line))
            return
        print(f"Opened {resolved_kind}", flush=True)
        outbox.push(json.dumps({"protocol": "aura", "type": "hud.hide"}))

    def on_event(event: ContextEvent, snapshot: ContextSnapshot) -> None:
        remember_window(history_holder["store"], event)
        if event.event_type not in HUD_EVENT_TYPES:
            return
        consider_snapshot(snapshot)

    if model_settings(config) is not None:
        advisor = ModelAdvisor(
            config,
            entries,
            on_model,
            suggest_from_history,
            on_failure=on_failure,
            report=report,
        )
        advisor.start()
        report.set("initialisation", "ok", "Model advisor started")
        print("Model is on. It runs only when no rule matches.", flush=True)
    elif missing_openai_key(config):
        report.set("initialisation", "skipped", "Model was not started")
        report.mark_unavailable()
        print(
            "Model is off. Add the key to aura.secrets.json or AURA_OPENAI_API_KEY.",
            flush=True,
        )
    else:
        report.set("initialisation", "skipped", "Model was not started")
        report.mark_unavailable()
        print("Model is off. Rules only.", flush=True)

    history_holder["store"] = open_history(config)
    manager.subscribe(on_event)
    if clipboard_enabled:
        manager.register_collector(ClipboardCollector())
    manager.register_collector(ActiveWindowCollector())
    collector = ScratchpadCollector(note_path)
    stop = threading.Event()
    threading.Thread(
        target=serve,
        args=(outbox.snapshot, stop, outbox.drain),
        daemon=True,
    ).start()
    threading.Thread(target=serve_actions, args=(on_action, stop), daemon=True).start()
    try:
        manager.start()
        collector.start(manager.publish)
        print(f"Watching {note_path}", flush=True)
        print("Leave this window open. Press Ctrl+C to stop.", flush=True)
        while not stop.wait(0.5):
            pass
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        if advisor is not None:
            advisor.stop()
        collector.stop()
        manager.stop()
        store = history_holder["store"]
        if store is not None:
            try:
                store.close_current()
            except Exception:
                print("History write failed", flush=True)
            store.close()


if __name__ == "__main__":
    main()
