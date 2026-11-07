"""Foreground-app history for a later model call.

A row is one stretch of time an app stayed in front. Shell processes, the
Aura window, and switches shorter than two seconds are left out. Clipboard
text and note bodies are never written here.
"""

import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from context.core.events import utc_now
from memory.database import Database

MIN_DURATION_MS = 2000
_RECENT_FINISHED = 12
_FREQUENT_LIMIT = 5
_FREQUENT_HOURS = 24

# Hosts that flash a window without being the app the user is working in.
_NOISE = frozenset(
    {
        "applicationframehost",
        "textinputhost",
        "shellexperiencehost",
        "startmenuexperiencehost",
        "searchhost",
        "searchapp",
        "lockapp",
        "runtimebroker",
        "systemsettingsbroker",
        "widgetboard",
        "widgets",
        "phoneexperiencehost",
        "gamebar",
        "gamebarftserver",
        "backgroundtaskhost",
        "dllhost",
        "conhost",
        "sihost",
        "ctfmon",
        "dwm",
    }
)


def history_path(config: dict[str, Any] | None = None) -> Path:
    """Default history file, unless config sets historyPath."""

    configured = str((config or {}).get("historyPath") or "").strip()
    if configured:
        return Path(configured)
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "aura" / "history.sqlite"
    return Path.home() / ".local" / "share" / "aura" / "history.sqlite"


def _file_name(process_name: str) -> str:
    return Path(process_name.strip()).name


def _label(process_name: str) -> str:
    name = _file_name(process_name).casefold()
    if name.endswith(".exe"):
        return name[:-4]
    return name


def _classify(process_name: str, window_title: str) -> str:
    """Return focus, away, or ignore for one foreground sample."""

    title = window_title.strip()
    if not process_name.strip():
        return "ignore"
    label = _label(process_name)
    if label in _NOISE or label == "aura" or title.casefold() == "aura":
        return "ignore"
    if not title:
        return "ignore"
    if label == "explorer" and title.casefold() == "program manager":
        return "away"
    return "focus"


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalize(value: str) -> str:
    return _parse_time(value).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _row_dict(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def _duration_ms(started_at: str, ended_at: str) -> int:
    elapsed = _parse_time(ended_at) - _parse_time(started_at)
    return max(int(elapsed.total_seconds() * 1000), 0)


class FocusStore:
    """Save and read foreground sessions. Database errors propagate to the caller."""

    def __init__(self, path: Path) -> None:
        self._db = Database(path)
        self._lock = threading.Lock()
        self.close_orphans()

    def close_orphans(self) -> None:
        """Close a session left open by a previous run without inventing time."""

        with self._lock:
            self._db.connection.execute(
                """
                UPDATE focus_sessions
                SET ended_at = started_at, duration_ms = 0
                WHERE ended_at IS NULL
                """
            )
            self._db.connection.commit()

    def record_window(self, process_name: str, window_title: str, at: str | None = None) -> None:
        """Open, update, or close a session from one foreground sample."""

        kind = _classify(process_name, window_title)
        moment = _normalize(at or utc_now())
        with self._lock:
            if kind == "ignore":
                return
            if kind == "away":
                self._end_open(moment)
                return
            name = _file_name(process_name)
            title = window_title.strip()
            current = self._open_row()
            if current is None:
                self._insert(name, title, moment)
                return
            if _label(current["process_name"]) == _label(name):
                if current["window_title"] != title:
                    self._db.connection.execute(
                        "UPDATE focus_sessions SET window_title = ? WHERE id = ?",
                        (title, current["id"]),
                    )
                    self._db.connection.commit()
                return
            self._end_open(moment)
            self._insert(name, title, moment)

    def close_current(self, at: str | None = None) -> None:
        """End the open session when the watcher stops."""

        moment = _normalize(at or utc_now())
        with self._lock:
            self._end_open(moment)

    def get_process_history(
        self,
        recent_limit: int = _RECENT_FINISHED,
        frequent_limit: int = _FREQUENT_LIMIT,
        at: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        """Return a short payload. This is the history a model is allowed to see."""

        moment = _normalize(at or utc_now())
        cutoff = _normalize(
            (_parse_time(moment) - timedelta(hours=_FREQUENT_HOURS)).isoformat()
        )
        with self._lock:
            connection = self._db.connection
            open_row = _row_dict(
                connection.execute(
                    """
                    SELECT process_name, window_title, started_at
                    FROM focus_sessions
                    WHERE ended_at IS NULL
                    ORDER BY started_at DESC
                    LIMIT 1
                    """
                ).fetchone()
            )
            finished = [
                _row_dict(row)
                for row in connection.execute(
                    """
                    SELECT process_name, window_title, started_at, duration_ms
                    FROM focus_sessions
                    WHERE duration_ms >= ?
                    ORDER BY started_at DESC
                    LIMIT ?
                    """,
                    (MIN_DURATION_MS, recent_limit),
                ).fetchall()
            ]
            usage = [
                _row_dict(row)
                for row in connection.execute(
                    """
                    SELECT process_name, ended_at, duration_ms
                    FROM focus_sessions
                    WHERE duration_ms >= ? AND started_at >= ?
                    """,
                    (MIN_DURATION_MS, cutoff),
                ).fetchall()
            ]

        recent: list[dict[str, Any]] = []
        if open_row is not None:
            recent.append(
                {
                    "process_name": open_row["process_name"],
                    "window_title": open_row["window_title"],
                    "started_at": open_row["started_at"],
                    "duration_ms": None,
                }
            )
        for row in finished:
            recent.append(
                {
                    "process_name": row["process_name"],
                    "window_title": row["window_title"],
                    "started_at": row["started_at"],
                    "duration_ms": row["duration_ms"],
                }
            )

        totals: dict[str, dict[str, Any]] = {}
        for row in usage:
            self._add_usage(
                totals,
                row["process_name"],
                int(row["duration_ms"]),
                row["ended_at"],
            )
        if open_row is not None and open_row["started_at"] >= cutoff:
            elapsed = _duration_ms(open_row["started_at"], moment)
            if elapsed >= MIN_DURATION_MS:
                self._add_usage(totals, open_row["process_name"], elapsed, moment)
        frequent = sorted(
            totals.values(),
            key=lambda item: (item["total_ms"], item["last_seen"]),
            reverse=True,
        )[:frequent_limit]
        return {"recent": recent, "frequent": frequent}

    def close(self) -> None:
        self._db.close()

    def _open_row(self) -> dict[str, Any] | None:
        return _row_dict(
            self._db.connection.execute(
                """
                SELECT id, process_name, window_title, started_at
                FROM focus_sessions
                WHERE ended_at IS NULL
                ORDER BY started_at DESC
                LIMIT 1
                """
            ).fetchone()
        )

    def _insert(self, process_name: str, window_title: str, started_at: str) -> None:
        self._db.connection.execute(
            """
            INSERT INTO focus_sessions
                (id, process_name, window_title, started_at, ended_at, duration_ms)
            VALUES (?, ?, ?, ?, NULL, NULL)
            """,
            (str(uuid4()), process_name, window_title, started_at),
        )
        self._db.connection.commit()

    def _end_open(self, moment: str) -> None:
        current = self._open_row()
        if current is None:
            return
        elapsed = _duration_ms(current["started_at"], moment)
        if elapsed < MIN_DURATION_MS:
            self._db.connection.execute(
                "DELETE FROM focus_sessions WHERE id = ?",
                (current["id"],),
            )
        else:
            self._db.connection.execute(
                """
                UPDATE focus_sessions
                SET ended_at = ?, duration_ms = ?
                WHERE id = ?
                """,
                (moment, elapsed, current["id"]),
            )
        self._db.connection.commit()

    @staticmethod
    def _add_usage(
        totals: dict[str, dict[str, Any]],
        process_name: str,
        duration_ms: int,
        last_seen: str,
    ) -> None:
        key = _label(process_name)
        bucket = totals.get(key)
        if bucket is None:
            totals[key] = {
                "process_name": process_name,
                "focus_count": 1,
                "total_ms": duration_ms,
                "last_seen": last_seen,
            }
            return
        bucket["focus_count"] += 1
        bucket["total_ms"] += duration_ms
        if last_seen >= bucket["last_seen"]:
            bucket["last_seen"] = last_seen
            bucket["process_name"] = process_name
