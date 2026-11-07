from pathlib import Path

from context.core.models import ContextSnapshot
from bridge.rules import first_match, load_json, project_paths


def snapshot_from_config(config: dict) -> ContextSnapshot:
    note_path = Path(str(config.get("scratchpadPath", "")))
    if note_path.is_file():
        note = note_path.read_text(encoding="utf-8")
        title = note_path.name
    else:
        note = "keep going on the platformer"
        title = "aura-scratch.md"
    return ContextSnapshot(
        platform="windows",
        clipboard_enabled=bool(config.get("clipboardEnabled", True)),
        clipboard_content_type="empty",
        clipboard_text=None,
        process_name="Notepad.exe",
        window_title=title,
        note_body=note,
    )


def main() -> None:
    config_path, rules_path = project_paths()
    config = load_json(config_path)
    rules = load_json(rules_path)
    suggestion = first_match(snapshot_from_config(config), rules, config)
    if suggestion is None:
        print("No suggestion for this context")
        return
    print(suggestion["title"])
    print(suggestion["detail"])
    print("source:", suggestion["source"])


if __name__ == "__main__":
    main()
