"""Start the program chosen from a dashboard card."""

import json
import os
import subprocess

KINDS = ("open_godot", "open_terminal", "focus_discord")
CREATE_NO_WINDOW = 0x08000000


def parse_action(line: str) -> str:
    kind = json.loads(line).get("kind")
    if kind not in KINDS:
        raise ValueError(f"Unknown action: {kind}")
    return str(kind)


def perform(kind: str, config: dict) -> None:
    if kind == "open_godot":
        path = str(config.get("godotProject", ""))
        if not path or not os.path.exists(path):
            raise FileNotFoundError(path or "godotProject is empty")
        os.startfile(path)  # type: ignore[attr-defined]
        return
    if kind == "open_terminal":
        repo = str(config.get("gitRepo", ""))
        if not repo or not os.path.isdir(repo):
            raise FileNotFoundError(repo or "gitRepo is empty")
        _open_terminal(repo)
        return
    if kind == "focus_discord":
        _open_discord()
        return
    raise ValueError(kind)


def _open_terminal(repo: str) -> None:
    try:
        subprocess.Popen(["wt.exe", "-d", repo])
    except FileNotFoundError:
        quoted = json.dumps(repo)
        subprocess.Popen(
            ["powershell.exe", "-NoExit", "-Command", f"Set-Location -LiteralPath {quoted}"],
        )


def _open_discord() -> None:
    os.startfile("discord:")  # type: ignore[attr-defined]


def catalog(config: dict) -> list[dict[str, str]]:
    return [
        {
            "kind": "open_godot",
            "title": "Godot",
            "detail": str(config.get("godotProject", "")),
        },
        {
            "kind": "open_terminal",
            "title": "Terminal",
            "detail": str(config.get("gitRepo", "")),
        },
        {
            "kind": "focus_discord",
            "title": "Discord",
            "detail": "Discord",
        },
    ]
