"""Watch the scratchpad, match rules, and send the suggestion to the panel."""

import json
import threading
from pathlib import Path

from bridge.pipe_server import serve
from bridge.rules import first_match, load_json, project_paths
from bridge.state_snapshot import to_state_snapshot
from context.collectors.scratchpad import ScratchpadCollector
from context.core.events import ContextEvent
from context.core.manager import ContextManager
from context.core.models import ContextSnapshot


def main() -> None:
    config_path, rules_path = project_paths()
    config = load_json(config_path)
    rules = load_json(rules_path)
    note_path = Path(str(config["scratchpadPath"]))
    manager = ContextManager(
        clipboard_enabled=bool(config.get("clipboardEnabled", True)),
    )
    latest: dict[str, str | None] = {"line": None}

    def on_event(event: ContextEvent, snapshot: ContextSnapshot) -> None:
        if event.event_type != "scratchpad_changed":
            return
        suggestion = first_match(snapshot, rules, config)
        message = to_state_snapshot(snapshot, suggestion)
        latest["line"] = json.dumps(message, ensure_ascii=False)
        if suggestion is None:
            print("No suggestion for this context", flush=True)
            return
        print(suggestion["title"], flush=True)
        print(suggestion["detail"], flush=True)
        print("source:", suggestion["source"], flush=True)

    manager.subscribe(on_event)
    collector = ScratchpadCollector(note_path)
    collector.start(manager.publish)
    print(f"Watching {note_path}", flush=True)
    print("Leave this window open. Press Ctrl+C to stop.", flush=True)

    stop = threading.Event()
    pipe = threading.Thread(target=serve, args=(lambda: latest["line"], stop), daemon=True)
    pipe.start()
    try:
        while not stop.wait(0.5):
            pass
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        collector.stop()


if __name__ == "__main__":
    main()
