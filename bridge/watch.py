"""Watch the scratchpad, match rules, and open the card the dashboard chooses."""

import json
import threading
from pathlib import Path

from bridge.launch import cards, load_entries, parse_action, perform
from bridge.pipe_server import serve, serve_actions
from bridge.rules import first_match, load_json, project_paths
from bridge.state_snapshot import to_state_snapshot
from context.collectors.active_window import ActiveWindowCollector
from context.collectors.clipboard import ClipboardCollector
from context.collectors.scratchpad import ScratchpadCollector
from context.core.events import ContextEvent
from context.core.manager import HUD_EVENT_TYPES, ContextManager
from context.core.models import ContextSnapshot


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

    def on_event(event: ContextEvent, snapshot: ContextSnapshot) -> None:
        if event.event_type not in HUD_EVENT_TYPES:
            return
        suggestion = first_match(snapshot, rules, config)
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
        message = to_state_snapshot(snapshot, suggestion, actions=shown)
        outbox.set_snapshot(json.dumps(message, ensure_ascii=False))
        if suggestion is None:
            print("No card suggested", flush=True)
            return
        print(f"Suggested {suggestion['kind']}", flush=True)

    def on_action(line: str) -> None:
        try:
            requested = json.loads(line).get("kind")
            if requested == "open_url":
                with url_lock:
                    url = matched_url["value"]
                perform("open_url", config, entries, target=url)
                kind = "open_url"
            else:
                kind = parse_action(line, entries)
                perform(kind, config, entries)
        except Exception as exc:
            print(f"Open failed: {exc}", flush=True)
            outbox.push(json.dumps({"protocol": "aura", "type": "hud.error", "message": str(exc)}))
            return
        print(f"Opened {kind}", flush=True)
        outbox.push(json.dumps({"protocol": "aura", "type": "hud.hide"}))

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
        collector.stop()
        manager.stop()


if __name__ == "__main__":
    main()
