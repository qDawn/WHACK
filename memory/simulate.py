"""Write a fixed day of foreground sessions for a model test.

The day is a platformer loop. Godot has the most time. Visual Studio Code
is the visit that just ended. The watcher reads this file when
aura.config.json sets historyPath.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from memory.database import Database

# Oldest first. Durations are seconds.
SESSIONS: tuple[tuple[str, str, int], ...] = (
    ("chrome.exe", "Godot documentation - Google Chrome", 8 * 60),
    ("Code.exe", "player.gd - Visual Studio Code", 25 * 60),
    ("Godot.exe", "platformer - Godot Engine", 40 * 60),
    ("WindowsTerminal.exe", "platformer", 4 * 60),
    ("Discord.exe", "friends - Discord", 6 * 60),
    ("Spotify.exe", "Spotify", 12 * 60),
    ("chrome.exe", "GDScript reference - Google Chrome", 7 * 60),
    ("Code.exe", "enemy.gd - Visual Studio Code", 20 * 60),
    ("Godot.exe", "platformer - Godot Engine", 35 * 60),
    ("WindowsTerminal.exe", "platformer", 5 * 60),
    ("Discord.exe", "friends - Discord", 6 * 60),
    ("explorer.exe", "platformer", 4 * 60),
    ("Notepad.exe", "todo.txt - Notepad", 3 * 60),
    ("Code.exe", "player.gd - Visual Studio Code", 22 * 60),
    ("Godot.exe", "platformer - Godot Engine", 45 * 60),
    ("Code.exe", "hud.gd - Visual Studio Code", 18 * 60),
)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def session_rows(ended_at: datetime | None = None) -> list[tuple[str, str, str, str, str, int]]:
    """Closed sessions ending a minute before ended_at, oldest first."""

    cursor = (ended_at or datetime.now(timezone.utc)).astimezone(timezone.utc) - timedelta(minutes=1)
    timed: list[tuple[str, str, datetime, datetime, int]] = []
    for process_name, window_title, seconds in reversed(SESSIONS):
        finished = cursor
        started = finished - timedelta(seconds=seconds)
        timed.append((process_name, window_title, started, finished, seconds * 1000))
        cursor = started - timedelta(seconds=30)
    timed.reverse()
    return [
        (str(uuid4()), process_name, window_title, _iso(started), _iso(finished), duration_ms)
        for process_name, window_title, started, finished, duration_ms in timed
    ]


def seed_history(path: Path, ended_at: datetime | None = None) -> Path:
    """Replace the history file with the simulated day."""

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(f"{path}{suffix}")
        if candidate.exists():
            candidate.unlink()
    database = Database(path)
    try:
        database.connection.executemany(
            """
            INSERT INTO focus_sessions
                (id, process_name, window_title, started_at, ended_at, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            session_rows(ended_at),
        )
        database.connection.commit()
    finally:
        database.close()
    return path


def main() -> None:
    from bridge.rules import load_json, project_paths
    from memory.focus_store import history_path

    config = load_json(project_paths()[0])
    path = seed_history(history_path(config))
    print(f"Wrote simulated history to {path}", flush=True)


if __name__ == "__main__":
    main()
