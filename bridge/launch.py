"""Start the catalog entry chosen from a dashboard card."""

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from bridge.rules import ROOT, substitute

METHODS = ("file", "command", "link")


def load_entries(path: Path | None = None) -> list[dict[str, Any]]:
    catalog_path = path or (ROOT / "catalog.json")
    document = json.loads(catalog_path.read_text(encoding="utf-8"))
    entries = document.get("entries", [])
    if not isinstance(entries, list) or not entries:
        raise ValueError("catalog.json needs an entries list")
    for entry in entries:
        if entry.get("method") not in METHODS or not entry.get("id"):
            raise ValueError(f"Invalid catalog entry: {entry.get('id')}")
    return entries


def cards(entries: list[dict[str, Any]], config: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "kind": str(entry["id"]),
            "title": str(entry.get("title", entry["id"])),
            "detail": substitute(str(entry.get("detail", "")), config),
        }
        for entry in entries
    ]


def parse_action(line: str, entries: list[dict[str, Any]]) -> str:
    kind = json.loads(line).get("kind")
    allowed = {str(entry["id"]) for entry in entries}
    if kind not in allowed:
        raise ValueError(f"Unknown action: {kind}")
    return str(kind)


def perform(
    kind: str,
    config: dict[str, Any],
    entries: list[dict[str, Any]],
    target: str | None = None,
) -> None:
    if kind == "open_url":
        entry: dict[str, Any] | None = {"id": "open_url", "method": "link", "target": target or ""}
    else:
        entry = next((item for item in entries if item["id"] == kind), None)
    if entry is None:
        raise ValueError(f"Unknown action: {kind}")
    method = entry["method"]
    if method == "file":
        _open_file(substitute(str(entry.get("target", "")), config))
        return
    if method == "link":
        _open_link(substitute(str(entry.get("target", "")), config))
        return
    if method == "command":
        _run_command(entry, config)
        return
    raise ValueError(f"Unknown launch method: {method}")


def _open_file(path: str) -> None:
    if not path or not os.path.exists(path):
        raise FileNotFoundError(path or "file target is empty")
    os.startfile(path)  # type: ignore[attr-defined]


def _open_link(target: str) -> None:
    if not target:
        raise ValueError("link target is empty")
    os.startfile(target)  # type: ignore[attr-defined]


def _run_command(entry: dict[str, Any], config: dict[str, Any]) -> None:
    command = _directory_fallback(entry, _arguments(entry.get("command"), config), config)
    try:
        subprocess.Popen(command)
    except FileNotFoundError:
        fallback = entry.get("fallback")
        if not fallback:
            raise
        subprocess.Popen(_directory_fallback(entry, _arguments(fallback, config), config))


def _directory_fallback(
    entry: dict[str, Any],
    command: list[str],
    config: dict[str, Any],
) -> list[str]:
    """Use directoryFallback when a command names a gitRepo directory that is not there."""

    replacement = substitute(str(entry.get("directoryFallback", "") or ""), config)
    repo = substitute("${gitRepo}", config)
    if not replacement or not repo or os.path.isdir(repo):
        return command
    return [part.replace(repo, replacement) for part in command]


def _arguments(values: Any, config: dict[str, Any]) -> list[str]:
    if not isinstance(values, list) or not values:
        raise ValueError("command needs an argument list")
    return [substitute(str(part), config) for part in values]
