"""Ask an OpenAI-compatible model only after every rule misses.

An empty baseUrl or model name leaves suggestions to the rules. The reply
is accepted only when it names one catalog id.
"""

from dataclasses import replace
import json
import os
from pathlib import Path
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from bridge.rules import ROOT, substitute
from context.core.models import ContextSnapshot

INSTRUCTIONS_PATH = ROOT / "model_instructions.md"
_FALLBACK_INSTRUCTIONS = (
    "You choose the one next app for this person. "
    "Reply with one app id from the list, or none. No other words."
)
_MISSING = object()
Suggest = Callable[[ContextSnapshot, list[dict[str, Any]], dict[str, Any]], dict[str, str] | None]
ResultHandler = Callable[[ContextSnapshot, dict[str, str] | None], None]


class ModelError(Exception):
    """The model endpoint did not return a usable reply."""


def resolve_api_key(config: dict[str, Any], secrets_path: Path | None = None) -> str:
    """Key from the environment, then config, then the gitignored secrets file."""

    from_env = os.environ.get("AURA_OPENAI_API_KEY", "").strip()
    if from_env:
        return from_env
    configured = str((config.get("model") or {}).get("apiKey") or "").strip()
    if configured:
        return configured
    path = ROOT / "aura.secrets.json" if secrets_path is None else secrets_path
    if not path.is_file():
        return ""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return ""
    if not isinstance(data, dict):
        return ""
    return str(data.get("apiKey") or "").strip()


def _is_openai(base_url: str) -> bool:
    return (urllib.parse.urlparse(base_url).hostname or "").casefold() == "api.openai.com"


def missing_openai_key(config: dict[str, Any], secrets_path: Path | None = None) -> bool:
    model = config.get("model") or {}
    base_url = str(model.get("baseUrl") or "").strip()
    name = str(model.get("name") or "").strip()
    if not base_url or not name or not _is_openai(base_url):
        return False
    return resolve_api_key(config, secrets_path) == ""


def model_settings(
    config: dict[str, Any],
    secrets_path: Path | None = None,
) -> dict[str, Any] | None:
    model = config.get("model") or {}
    base_url = str(model.get("baseUrl") or "").strip()
    name = str(model.get("name") or "").strip()
    if not base_url or not name:
        return None
    api_key = resolve_api_key(config, secrets_path)
    if _is_openai(base_url) and not api_key:
        return None
    timeout_ms = model.get("timeoutMs") or 8000
    try:
        timeout_s = max(int(timeout_ms), 1) / 1000
    except (TypeError, ValueError):
        timeout_s = 8
    return {
        "url": chat_url(base_url),
        "api_key": api_key,
        "name": name,
        "timeout": timeout_s,
    }


def chat_url(base_url: str) -> str:
    base_url = base_url.rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    return f"{base_url}/chat/completions"


def fingerprint(snapshot: ContextSnapshot) -> tuple[str, str, str, bool, str]:
    return (
        snapshot.process_name,
        snapshot.window_title,
        snapshot.note_body,
        snapshot.clipboard_enabled,
        snapshot.clipboard_text or "",
    )


def load_instructions(path: Path | None = None) -> str:
    """The markdown brief sent as the model's system message."""

    file = INSTRUCTIONS_PATH if path is None else path
    try:
        text = file.read_text(encoding="utf-8").strip()
    except OSError:
        return _FALLBACK_INSTRUCTIONS
    return text or _FALLBACK_INSTRUCTIONS


def _visit_length(duration_ms: int | None) -> str:
    if duration_ms is None:
        return "still in front"
    return f"{max(int(duration_ms) // 1000, 0)}s"


def format_history(history: dict[str, Any] | None) -> str:
    """Compact focus history. This is the only database content the model sees."""

    recent = list((history or {}).get("recent") or [])
    frequent = list((history or {}).get("frequent") or [])
    lines = ["recent focus:"]
    if not recent:
        lines.append("- none")
    for item in recent:
        lines.append(
            "- {process} | {title} | {length}".format(
                process=item.get("process_name") or "",
                title=item.get("window_title") or "",
                length=_visit_length(item.get("duration_ms")),
            )
        )
    lines.append("frequent apps:")
    if not frequent:
        lines.append("- none")
    for item in frequent:
        lines.append(
            "- {process} | visits {count} | {length}".format(
                process=item.get("process_name") or "",
                count=item.get("focus_count") or 0,
                length=_visit_length(item.get("total_ms")),
            )
        )
    return "\n".join(lines)


def prompt_for(
    snapshot: ContextSnapshot,
    entries: list[dict[str, Any]],
    history: dict[str, Any] | None = None,
) -> str:
    lines = [
        f"process: {snapshot.process_name}",
        f"window: {snapshot.window_title}",
        f"note: {snapshot.note_body}",
    ]
    if snapshot.clipboard_enabled:
        lines.append(f"clipboard: {snapshot.clipboard_text or ''}")
    else:
        lines.append("clipboard: disabled")
    lines.append(format_history(history))
    lines.append("apps:")
    for entry in entries:
        lines.append(f"- {entry['id']}: {entry.get('title', entry['id'])}")
    return "\n".join(lines)


def parse_choice(text: str, allowed: set[str]) -> str | None:
    folded = text.strip().casefold()
    if folded in {"", "none", "null"}:
        return None
    found = [
        kind
        for kind in allowed
        if re.search(rf"\b{re.escape(kind.casefold())}\b", folded)
    ]
    if len(found) == 1:
        return found[0]
    return None


def post_chat(settings: dict[str, Any], payload: dict[str, Any]) -> str:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if settings.get("api_key"):
        headers["Authorization"] = f"Bearer {settings['api_key']}"
    request = urllib.request.Request(settings["url"], data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=settings["timeout"]) as response:
            parsed = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise ModelError(str(exc)) from exc
    try:
        return str(parsed["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as exc:
        raise ModelError("reply was not a chat completion") from exc


def suggest(
    snapshot: ContextSnapshot,
    entries: list[dict[str, Any]],
    config: dict[str, Any],
    post: Callable[[dict[str, Any], dict[str, Any]], str] | None = None,
    history: dict[str, Any] | None = None,
    instructions_path: Path | None = None,
) -> dict[str, str] | None:
    settings = model_settings(config)
    if settings is None:
        return None
    payload = {
        "model": settings["name"],
        "temperature": 0,
        "messages": [
            {"role": "system", "content": load_instructions(instructions_path)},
            {"role": "user", "content": prompt_for(snapshot, entries, history)},
        ],
    }
    text = (post or post_chat)(settings, payload)
    kind = parse_choice(text, {str(entry["id"]) for entry in entries})
    if kind is None:
        return None
    entry = next(item for item in entries if str(item["id"]) == kind)
    return {
        "kind": kind,
        "title": str(entry.get("title", kind)),
        "detail": substitute(str(entry.get("detail", "")), config),
        "reason": "No rule matched. The model chose this from recent app history.",
        "source": "model",
    }


class ModelAdvisor:
    """Call the model for the latest rule miss, and reuse that answer."""

    def __init__(
        self,
        config: dict[str, Any],
        entries: list[dict[str, Any]],
        on_result: ResultHandler,
        suggest_fn: Suggest = suggest,
        debounce_s: float = 0.6,
    ) -> None:
        self._config = config
        self._entries = entries
        self._on_result = on_result
        self._suggest = suggest_fn
        self._debounce_s = debounce_s
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._generation = 0
        self._pending: tuple[int, ContextSnapshot, tuple[str, str, str, bool, str]] | None = None
        self._cache: dict[tuple[str, str, str, bool, str], dict[str, str] | None] = {}
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        self._thread.join(timeout=2)

    def cancel(self) -> None:
        with self._lock:
            self._generation += 1
            self._pending = None

    def consider(self, snapshot: ContextSnapshot) -> None:
        key = fingerprint(snapshot)
        with self._lock:
            self._generation += 1
            cached = self._cache.get(key, _MISSING)
            if cached is _MISSING:
                self._pending = (self._generation, replace(snapshot), key)
            else:
                self._pending = None
        if cached is not _MISSING:
            self._on_result(snapshot, cached)
            return
        self._wake.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            self._wake.wait()
            self._wake.clear()
            if self._stop.is_set() or self._stop.wait(self._debounce_s):
                return
            with self._lock:
                pending = self._pending
                self._pending = None
            if pending is None:
                continue
            generation, snapshot, key = pending
            try:
                suggestion = self._suggest(snapshot, self._entries, self._config)
            except ModelError:
                print("Model request failed", flush=True)
                continue
            with self._lock:
                if generation != self._generation:
                    continue
                self._cache[key] = suggestion
                if len(self._cache) > 20:
                    self._cache.pop(next(iter(self._cache)))
            self._on_result(snapshot, suggestion)
