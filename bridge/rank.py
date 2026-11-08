"""Pick the real cards the dashboard is allowed to show."""

from typing import Any

_PROCESS_KINDS = {
    "godot": "open_godot",
    "windowsterminal": "open_terminal",
    "wt": "open_terminal",
    "powershell": "open_powershell",
    "pwsh": "open_powershell",
    "cmd": "open_command",
    "discord": "focus_discord",
    "code": "open_vscode",
    "cursor": "open_cursor",
    "chrome": "open_chrome",
    "msedge": "open_edge",
    "firefox": "open_firefox",
    "explorer": "open_explorer",
    "notepad": "open_notepad",
    "calc": "open_calculator",
    "mspaint": "open_paint",
    "spotify": "open_spotify",
    "steam": "open_steam",
    "slack": "open_slack",
    "msteams": "open_teams",
    "teams": "open_teams",
    "whatsapp": "open_whatsapp",
    "telegram": "open_telegram",
    "winword": "open_word",
    "excel": "open_excel",
    "powerpnt": "open_powerpoint",
    "onenote": "open_onenote",
    "notion": "open_notion",
    "figma": "open_figma",
}


def kind_for_process(process_name: str) -> str | None:
    label = process_name.strip().rsplit("\\", 1)[-1].rsplit("/", 1)[-1]
    if label.casefold().endswith(".exe"):
        label = label[:-4]
    label = label.casefold()
    if label in _PROCESS_KINDS:
        return _PROCESS_KINDS[label]
    for prefix, kind in _PROCESS_KINDS.items():
        if label.startswith(prefix):
            return kind
    return None


def top_cards(
    actions: list[dict[str, str]],
    suggestion: dict[str, Any] | None,
    history: dict[str, Any] | None,
    limit: int = 3,
) -> list[dict[str, str]]:
    """Primary suggestion, then frequent history, then recent history.

    Kinds missing from ``actions`` are skipped. Unmapped process names are
    skipped. Catalog order is not used to fill empty slots, so an empty
    history with no usable suggestion returns an empty list. The default
    limit stays 3; the watcher asks for 8.
    """

    by_kind = {card["kind"]: card for card in actions}
    chosen: list[dict[str, str]] = []

    def add(kind: str | None) -> None:
        if not kind or any(card["kind"] == kind for card in chosen):
            return
        card = by_kind.get(kind)
        if card is not None:
            chosen.append(card)

    if suggestion is not None:
        add(str(suggestion.get("kind") or ""))
        if len(chosen) >= limit:
            return chosen
    record = history or {}
    for bucket in ("frequent", "recent"):
        for item in record.get(bucket) or []:
            add(kind_for_process(str(item.get("process_name") or "")))
            if len(chosen) >= limit:
                return chosen
    return chosen
