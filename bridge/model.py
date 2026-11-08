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
Suggest = Callable[..., dict[str, str] | None]
ResultHandler = Callable[[ContextSnapshot, dict[str, str] | None], None]
FailureHandler = Callable[[ContextSnapshot, str], None]


class ModelError(Exception):
    """The model endpoint did not return a usable reply."""

    def __init__(self, message: str, *, stage: str = "requestDelivery") -> None:
        super().__init__(message)
        self.stage = stage


DIAGNOSTIC_STAGES = (
    "initialisation",
    "availability",
    "requestGeneration",
    "contextSupplied",
    "requestDelivery",
    "inferenceCompletion",
    "responseRetrieval",
    "recommendationRanking",
    "frontendDelivery",
    "lastError",
)
_ATTEMPT_STAGES = (
    "requestGeneration",
    "contextSupplied",
    "requestDelivery",
    "inferenceCompletion",
    "responseRetrieval",
    "recommendationRanking",
    "lastError",
)
_LOG_FIELDS = (
    "keyPresent",
    "host",
    "model",
    "fields",
    "noteLength",
    "clipboardLength",
    "windowTitlePresent",
    "processName",
    "clipboardIncluded",
    "historyRecent",
    "historyFrequent",
)


def redact(text: str, secret: str = "") -> str:
    """Short status text. A key, note, or clipboard value never belongs here."""

    cleaned = " ".join(text.split())
    if secret and secret in cleaned:
        cleaned = cleaned.replace(secret, "[redacted]")
    if len(cleaned) > 160:
        cleaned = cleaned[:157] + "..."
    return cleaned or "Model request failed"


def _log_stage(name: str, stage: dict[str, Any]) -> None:
    details = []
    for key in _LOG_FIELDS:
        if key in stage:
            details.append(f"{key}={stage[key]}")
    text = f"Model {name}: {stage.get('status', 'idle')}"
    message = stage.get("message")
    if isinstance(message, str) and message:
        text += f" — {message}"
    if details:
        text += f" ({', '.join(details)})"
    print(text, flush=True)


def _copy_stage(stage: dict[str, Any]) -> dict[str, Any]:
    copied: dict[str, Any] = {}
    for key, value in stage.items():
        copied[key] = list(value) if isinstance(value, list) else value
    return copied


class ModelReport:
    """Stage status for one watcher. Safe to put on the HUD snapshot."""

    def __init__(self, log: bool = True) -> None:
        self._log = log
        self._lock = threading.Lock()
        self._stages: dict[str, dict[str, Any]] = {
            name: {"status": "idle"} for name in DIAGNOSTIC_STAGES
        }

    def set(self, name: str, status: str, message: str = "", **fields: Any) -> None:
        stage: dict[str, Any] = {"status": status}
        if message:
            stage["message"] = message
        for key, value in fields.items():
            if value is not None:
                stage[key] = value
        with self._lock:
            changed = self._stages.get(name) != stage
            self._stages[name] = stage
        if changed and self._log:
            _log_stage(name, stage)

    def public(self) -> dict[str, Any]:
        with self._lock:
            return {name: _copy_stage(stage) for name, stage in self._stages.items()}

    def configure(self, config: dict[str, Any], secrets_path: Path | None = None) -> None:
        described = describe_availability(config, secrets_path)
        self.set(
            "availability",
            described["status"],
            described["message"],
            keyPresent=described["keyPresent"],
            host=described["host"],
            model=described["model"],
        )

    def mark_unavailable(self) -> None:
        availability = self.public()["availability"]
        message = "Model is off."
        if availability.get("status") == "error" and availability.get("message"):
            message = str(availability["message"])
        for name in _ATTEMPT_STAGES:
            if name == "lastError":
                continue
            self.set(name, "skipped", "Model is off.")
        if availability.get("status") == "error":
            self.set("lastError", "error", message)
        else:
            self.set("lastError", "idle")

    def rule_matched(self) -> None:
        """A rule won. Clear a request failure without claiming the model ran."""

        if self.public()["availability"].get("status") != "ok":
            return
        for name in _ATTEMPT_STAGES:
            if name == "lastError":
                continue
            self.set(name, "skipped", "A rule matched.")
        self.set("lastError", "idle")

    def fail_attempt(self, message: str, stage: str) -> None:
        message = message or "Model request failed"
        if stage == "responseRetrieval":
            self.set("requestDelivery", "ok", "Response received")
            self.set("inferenceCompletion", "error", message)
            self.set("responseRetrieval", "error", message)
        else:
            self.set("requestDelivery", "error", message)
            self.set("inferenceCompletion", "skipped", "No completion")
            self.set("responseRetrieval", "skipped", "No reply")
        self.set("recommendationRanking", "skipped", "No model ranking")
        self.set("lastError", "error", message)

    def apply_attempt(self, attempt: "ModelReport") -> None:
        self.restore_attempt(attempt.public())

    def restore_attempt(self, stages: dict[str, Any]) -> None:
        for name in _ATTEMPT_STAGES:
            stage = stages.get(name) or {"status": "idle"}
            if not isinstance(stage, dict):
                continue
            extras = {
                key: value
                for key, value in stage.items()
                if key not in {"status", "message"}
            }
            self.set(name, str(stage.get("status") or "idle"), str(stage.get("message") or ""), **extras)


def describe_availability(
    config: dict[str, Any],
    secrets_path: Path | None = None,
) -> dict[str, Any]:
    """Key presence, host, and model name. The key itself stays out."""

    model = config.get("model") or {}
    base_url = str(model.get("baseUrl") or "").strip()
    name = str(model.get("name") or "").strip()
    host = urllib.parse.urlparse(base_url).hostname or "" if base_url else ""
    key_present = resolve_api_key(config, secrets_path) != ""
    if not base_url or not name:
        return {
            "status": "skipped",
            "message": "Model is off.",
            "keyPresent": key_present,
            "host": host,
            "model": name,
        }
    if _is_openai(base_url) and not key_present:
        return {
            "status": "error",
            "message": "Model is off. No API key.",
            "keyPresent": False,
            "host": host,
            "model": name,
        }
    return {
        "status": "ok",
        "message": "Model is available.",
        "keyPresent": key_present,
        "host": host,
        "model": name,
    }


def card_for_miss(
    history_card: dict[str, str] | None,
    last_model: dict[str, str] | None,
    *,
    failed: bool = False,
    model_card: dict[str, str] | None = None,
) -> dict[str, str] | None:
    """Keep the last model card when a later attempt fails or has not answered.

    A miss with no stored model card stays on the history card.
    """

    if not failed and model_card is not None:
        return model_card
    if last_model is not None:
        return last_model
    return history_card


def _context_fields(
    snapshot: ContextSnapshot,
    history: dict[str, Any] | None,
) -> dict[str, Any]:
    included = ["process", "window", "note", "history"]
    clipboard_included = bool(snapshot.clipboard_enabled)
    if clipboard_included:
        included.append("clipboard")
    return {
        "fields": included,
        "noteLength": len(snapshot.note_body or ""),
        "clipboardLength": len(snapshot.clipboard_text or "") if clipboard_included else 0,
        "windowTitlePresent": bool(snapshot.window_title),
        "processName": snapshot.process_name,
        "clipboardIncluded": clipboard_included,
        "historyRecent": len(list((history or {}).get("recent") or [])),
        "historyFrequent": len(list((history or {}).get("frequent") or [])),
    }


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
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raise ModelError(f"HTTP {exc.code}") from exc
    except TimeoutError as exc:
        raise ModelError("The model request timed out") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise ModelError("The model host did not answer") from exc
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ModelError("Reply was not JSON", stage="responseRetrieval") from exc
    try:
        return str(parsed["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as exc:
        raise ModelError("Reply was not a chat completion", stage="responseRetrieval") from exc


def suggest(
    snapshot: ContextSnapshot,
    entries: list[dict[str, Any]],
    config: dict[str, Any],
    post: Callable[[dict[str, Any], dict[str, Any]], str] | None = None,
    history: dict[str, Any] | None = None,
    instructions_path: Path | None = None,
    secrets_path: Path | None = None,
    report: ModelReport | None = None,
) -> dict[str, str] | None:
    settings = model_settings(config, secrets_path)
    if settings is None:
        if report is not None:
            report.configure(config, secrets_path)
            report.mark_unavailable()
        return None
    context = _context_fields(snapshot, history)
    if report is not None:
        report.configure(config, secrets_path)
        report.set("requestGeneration", "ok", "Chat request built")
        report.set("contextSupplied", "ok", "Context fields included", **context)
    payload = {
        "model": settings["name"],
        "temperature": 0,
        "messages": [
            {"role": "system", "content": load_instructions(instructions_path)},
            {"role": "user", "content": prompt_for(snapshot, entries, history)},
        ],
    }
    try:
        text = (post or post_chat)(settings, payload)
    except ModelError as exc:
        if report is not None:
            report.fail_attempt(redact(str(exc), str(settings.get("api_key") or "")), exc.stage)
        raise
    if report is not None:
        report.set("requestDelivery", "ok", "Response received")
        report.set("inferenceCompletion", "ok", "Completion received")
        report.set("responseRetrieval", "ok", "Reply text received")
    folded = text.strip().casefold()
    allowed = {str(entry["id"]) for entry in entries}
    if folded in {"", "none", "null"}:
        if report is not None:
            report.set("recommendationRanking", "skipped", "Model chose none")
            report.set("lastError", "idle")
        return None
    kind = parse_choice(text, allowed)
    if kind is None:
        if report is not None:
            report.set("recommendationRanking", "error", "Reply did not name one app")
            report.set("lastError", "error", "Reply did not name one app")
        return None
    if report is not None:
        report.set("recommendationRanking", "ok", "Chose one catalog id")
        report.set("lastError", "idle")
    entry = next(item for item in entries if str(item["id"]) == kind)
    return {
        "kind": kind,
        "title": str(entry.get("title", kind)),
        "detail": substitute(str(entry.get("detail", "")), config),
        "reason": "No rule matched. The model chose this from recent app history.",
        "source": "model",
    }


class _AttemptRecord:
    """One finished model attempt. A failure is remembered so it is not sent again."""

    def __init__(
        self,
        suggestion: dict[str, str] | None,
        failed: bool,
        message: str,
        stages: dict[str, Any],
    ) -> None:
        self.suggestion = suggestion
        self.failed = failed
        self.message = message
        self.stages = stages


class ModelAdvisor:
    """Call the model for the latest rule miss, and reuse that answer."""

    def __init__(
        self,
        config: dict[str, Any],
        entries: list[dict[str, Any]],
        on_result: ResultHandler,
        suggest_fn: Suggest = suggest,
        debounce_s: float = 0.6,
        on_failure: FailureHandler | None = None,
        report: ModelReport | None = None,
    ) -> None:
        self._config = config
        self._entries = entries
        self._on_result = on_result
        self._on_failure = on_failure
        self._suggest = suggest_fn
        self._debounce_s = debounce_s
        self._report = report if report is not None else ModelReport(log=False)
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._generation = 0
        self._pending: tuple[int, ContextSnapshot, tuple[str, str, str, bool, str]] | None = None
        self._cache: dict[tuple[str, str, str, bool, str], _AttemptRecord] = {}
        self._last_success: dict[str, str] | None = None
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

    def last_success(self) -> dict[str, str] | None:
        with self._lock:
            if self._last_success is None:
                return None
            return dict(self._last_success)

    def consider(self, snapshot: ContextSnapshot) -> None:
        key = fingerprint(snapshot)
        with self._lock:
            self._generation += 1
            cached = self._cache.get(key, _MISSING)
            if cached is _MISSING:
                self._pending = (self._generation, replace(snapshot), key)
            else:
                self._pending = None
        if isinstance(cached, _AttemptRecord):
            self._report.restore_attempt(cached.stages)
            if cached.failed:
                if self._on_failure is not None:
                    self._on_failure(snapshot, cached.message)
                return
            self._on_result(snapshot, cached.suggestion)
            return
        self._wake.set()

    def _remember(self, key: tuple[str, str, str, bool, str], record: _AttemptRecord) -> None:
        self._cache[key] = record
        if len(self._cache) > 20:
            self._cache.pop(next(iter(self._cache)))

    def _commit(
        self,
        generation: int,
        snapshot: ContextSnapshot,
        key: tuple[str, str, str, bool, str],
        attempt: ModelReport,
        suggestion: dict[str, str] | None,
        failed: bool,
        message: str,
    ) -> None:
        with self._lock:
            if generation != self._generation:
                return
            if suggestion is not None:
                self._last_success = dict(suggestion)
            self._remember(key, _AttemptRecord(suggestion, failed, message, attempt.public()))
            self._report.apply_attempt(attempt)
        if failed:
            print("Model request failed", flush=True)
            if self._on_failure is not None:
                self._on_failure(snapshot, message)
            return
        self._on_result(snapshot, suggestion)

    def _ensure_failure(self, attempt: ModelReport, exc: ModelError) -> str:
        secret = resolve_api_key(self._config)
        message = redact(str(exc), secret)
        if attempt.public()["lastError"].get("status") != "error":
            attempt.fail_attempt(message, exc.stage)
        stored = attempt.public()["lastError"].get("message")
        return str(stored or message)

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
            attempt = ModelReport(log=False)
            try:
                suggestion = self._suggest(snapshot, self._entries, self._config, report=attempt)
            except ModelError as exc:
                self._commit(
                    generation,
                    snapshot,
                    key,
                    attempt,
                    None,
                    True,
                    self._ensure_failure(attempt, exc),
                )
                continue
            except Exception:
                self._commit(
                    generation,
                    snapshot,
                    key,
                    attempt,
                    None,
                    True,
                    self._ensure_failure(attempt, ModelError("Model request failed")),
                )
                continue
            self._commit(generation, snapshot, key, attempt, suggestion, False, "")
