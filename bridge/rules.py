import json
from pathlib import Path
from typing import Any

from context.core.models import ContextSnapshot

ROOT = Path(__file__).resolve().parents[1]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def substitute(value: str, config: dict[str, Any]) -> str:
    tokens = {
        "${godotProject}": str(config.get("godotProject", "")),
        "${gitRepo}": str(config.get("gitRepo", "")),
        "${scratchpadPath}": str(config.get("scratchpadPath", "")),
    }
    for token, replacement in tokens.items():
        value = value.replace(token, replacement)
    return value


def _contains(haystack: str | None, needle: str) -> bool:
    if not needle:
        return False
    return needle.casefold() in (haystack or "").casefold()


def clause_matches(key: str, expected: str, snapshot: ContextSnapshot, config: dict[str, Any]) -> bool:
    needle = substitute(str(expected), config)
    if key == "noteContains":
        return _contains(snapshot.note_body, needle)
    if key == "clipboardContains":
        if not snapshot.clipboard_enabled:
            return False
        return _contains(snapshot.clipboard_text, needle)
    if key == "processIs":
        return snapshot.process_name.casefold() == needle.casefold()
    if key == "titleContains":
        return _contains(snapshot.window_title, needle)
    return False


def first_match(
    snapshot: ContextSnapshot,
    rules_doc: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, str] | None:
    """Return the suggestion for the first rule whose clauses all match."""

    for rule in rules_doc.get("rules", []):
        when = rule.get("when") or {}
        if not when:
            continue
        if not all(clause_matches(key, value, snapshot, config) for key, value in when.items()):
            continue
        suggest = rule["suggest"]
        return {
            "kind": str(suggest["kind"]),
            "title": str(suggest["title"]),
            "detail": substitute(str(suggest.get("target", "")), config),
            "reason": f"Matched rule {rule['id']}.",
            "source": "rule",
            "ruleId": str(rule["id"]),
        }
    return None


def project_paths() -> tuple[Path, Path]:
    return ROOT / "aura.config.json", ROOT / "rules" / "default.json"
