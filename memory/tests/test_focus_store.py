import io
import os
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from bridge.watch import read_process_history, remember_window
from context.core.events import ContextEvent
from memory.focus_store import FocusStore, history_path
from memory.simulate import seed_history

START = datetime(2026, 11, 7, 18, 0, tzinfo=timezone.utc)


def stamp(offset: timedelta) -> str:
    return (START + offset).isoformat()


def stored(path: Path) -> list[tuple]:
    connection = sqlite3.connect(path)
    try:
        return connection.execute(
            """
            SELECT process_name, window_title, ended_at IS NULL, duration_ms
            FROM focus_sessions
            ORDER BY started_at
            """
        ).fetchall()
    finally:
        connection.close()


class FocusStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.path = Path(self._temporary.name) / "history.sqlite"
        self.store = FocusStore(self.path)

    def tearDown(self) -> None:
        self.store.close()
        self._temporary.cleanup()

    def test_title_change_stays_one_session(self) -> None:
        self.store.record_window("Code.exe", "a.py", stamp(timedelta(0)))
        self.store.record_window("CODE.EXE", "b.py", stamp(timedelta(seconds=10)))

        rows = stored(self.path)
        self.assertEqual(rows, [("Code.exe", "b.py", 1, None)])
        recent = self.store.get_process_history(at=stamp(timedelta(seconds=10)))["recent"]
        self.assertEqual(recent[0]["window_title"], "b.py")
        self.assertIsNone(recent[0]["duration_ms"])

    def test_full_path_is_stored_as_the_file_name(self) -> None:
        self.store.record_window(
            r"C:\Users\nggro\AppData\Local\Programs\Microsoft VS Code\Code.exe",
            "main.py - Visual Studio Code",
            stamp(timedelta(0)),
        )

        self.assertEqual(stored(self.path)[0][0], "Code.exe")
        text = self.path.read_bytes()
        self.assertNotIn(b"nggro", text)

    def test_short_switch_is_dropped_and_two_seconds_is_kept(self) -> None:
        self.store.record_window("Code.exe", "a.py", stamp(timedelta(0)))
        self.store.record_window("Discord.exe", "friends", stamp(timedelta(seconds=0.5)))
        self.assertEqual(
            [(row[0], row[2]) for row in stored(self.path)],
            [("Discord.exe", 1)],
        )

        self.store.record_window("Godot.exe", "platformer", stamp(timedelta(seconds=2.5)))
        rows = stored(self.path)
        self.assertEqual(rows[0][0], "Discord.exe")
        self.assertEqual(rows[0][3], 2000)
        self.assertEqual(rows[1][0], "Godot.exe")
        self.assertEqual(rows[1][2], 1)

    def test_shell_and_aura_do_not_become_sessions(self) -> None:
        self.store.record_window("Code.exe", "a.py", stamp(timedelta(0)))
        for name, title in (
            ("SearchHost.exe", "Search"),
            ("ApplicationFrameHost.exe", "Settings"),
            ("hud.exe", "Aura"),
            ("aura.exe", "Aura HUD"),
            ("Code.exe", ""),
            ("", "Notepad"),
        ):
            self.store.record_window(name, title, stamp(timedelta(seconds=5)))

        self.assertEqual(
            [(row[0], row[2]) for row in stored(self.path)],
            [("Code.exe", 1)],
        )

    def test_desktop_ends_the_session_and_a_folder_window_counts(self) -> None:
        self.store.record_window("Code.exe", "a.py", stamp(timedelta(0)))
        self.store.record_window(
            "explorer.exe",
            "Program Manager",
            stamp(timedelta(seconds=5)),
        )
        self.assertEqual(stored(self.path), [("Code.exe", "a.py", 0, 5000)])

        self.store.record_window("explorer.exe", "WHACK", stamp(timedelta(seconds=10)))
        self.assertEqual(stored(self.path)[-1][0], "explorer.exe")
        self.assertEqual(stored(self.path)[-1][2], 1)

    def test_shutdown_keeps_a_real_session_only(self) -> None:
        self.store.record_window("Code.exe", "a.py", stamp(timedelta(0)))
        self.store.close_current(stamp(timedelta(seconds=5)))
        self.assertEqual(stored(self.path)[0][3], 5000)

        self.store.record_window("Discord.exe", "friends", stamp(timedelta(seconds=6)))
        self.store.close_current(stamp(timedelta(seconds=6.4)))
        self.assertEqual([row[0] for row in stored(self.path)], ["Code.exe"])

    def test_history_survives_reopen_and_a_crash_adds_no_time(self) -> None:
        self.store.record_window("Code.exe", "a.py", stamp(timedelta(0)))
        self.store.record_window("Discord.exe", "friends", stamp(timedelta(seconds=5)))
        self.store.close_current(stamp(timedelta(seconds=9)))
        self.store.close()

        reopened = FocusStore(self.path)
        try:
            history = reopened.get_process_history(at=stamp(timedelta(seconds=9)))
            self.assertEqual(
                [item["process_name"] for item in history["recent"]],
                ["Discord.exe", "Code.exe"],
            )
            self.assertEqual(history["recent"][0]["duration_ms"], 4000)
            self.assertEqual(history["frequent"][0]["process_name"], "Code.exe")
            self.assertEqual(history["frequent"][0]["total_ms"], 5000)
        finally:
            reopened.close()

        crashed = FocusStore(self.path)
        try:
            crashed.record_window("Godot.exe", "platformer", stamp(timedelta(hours=1)))
            crashed.close()
        finally:
            pass
        recovered = FocusStore(self.path)
        self.store = recovered
        rows = stored(self.path)
        godot = [row for row in rows if row[0] == "Godot.exe"]
        self.assertEqual(godot, [("Godot.exe", "platformer", 0, 0)])
        names = [
            item["process_name"]
            for item in recovered.get_process_history(at=stamp(timedelta(hours=1)))["recent"]
        ]
        self.assertNotIn("Godot.exe", names)

    def test_history_for_the_model_is_recent_use_and_a_day_of_totals(self) -> None:
        self.store.record_window("explorer.exe", "Projects", stamp(timedelta(days=-3)))
        self.store.record_window("Hold.exe", "hold", stamp(timedelta(days=-3, seconds=60)))
        self.store.close_current(stamp(timedelta(days=-3, seconds=60.5)))

        self.store.record_window("Code.exe", "main.py", stamp(timedelta(minutes=-40)))
        self.store.record_window("Discord.exe", "friends", stamp(timedelta(minutes=-40, seconds=30)))
        self.store.record_window("Godot.exe", "platformer", stamp(timedelta(minutes=-40, seconds=40)))
        self.store.record_window("Hold.exe", "hold", stamp(timedelta(minutes=-40, seconds=45)))
        self.store.close_current(stamp(timedelta(minutes=-40, seconds=45.5)))
        self.store.record_window("Notepad.exe", "aura-scratch.md", stamp(timedelta(seconds=-8)))

        history = self.store.get_process_history(at=stamp(timedelta(0)))
        self.assertEqual(
            [item["process_name"] for item in history["recent"]],
            ["Notepad.exe", "Godot.exe", "Discord.exe", "Code.exe", "explorer.exe"],
        )
        self.assertIsNone(history["recent"][0]["duration_ms"])
        self.assertEqual(
            [(item["process_name"], item["total_ms"], item["focus_count"]) for item in history["frequent"]],
            [
                ("Code.exe", 30000, 1),
                ("Discord.exe", 10000, 1),
                ("Notepad.exe", 8000, 1),
                ("Godot.exe", 5000, 1),
            ],
        )
        self.assertNotIn("explorer.exe", [item["process_name"] for item in history["frequent"]])

    def test_repeat_visits_add_up_and_recent_stops_at_twelve(self) -> None:
        self.store.record_window("Code.exe", "a.py", stamp(timedelta(0)))
        self.store.record_window("Discord.exe", "friends", stamp(timedelta(seconds=5)))
        self.store.record_window("Code.exe", "b.py", stamp(timedelta(seconds=8)))
        history = self.store.get_process_history(at=stamp(timedelta(seconds=12)))
        code = history["frequent"][0]
        self.assertEqual(code["process_name"], "Code.exe")
        self.assertEqual(code["focus_count"], 2)
        self.assertEqual(code["total_ms"], 9000)

        for index in range(14):
            self.store.record_window(
                f"App{index}.exe",
                f"window {index}",
                stamp(timedelta(hours=2, seconds=index * 3)),
            )
        recent = self.store.get_process_history(
            at=stamp(timedelta(hours=2, seconds=14 * 3))
        )["recent"]
        self.assertEqual(len(recent), 13)
        self.assertEqual(recent[0]["process_name"], "App13.exe")
        self.assertNotIn("App0.exe", [item["process_name"] for item in recent])

    def test_history_path_prefers_config(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            chosen = Path(folder) / "custom.sqlite"
            self.assertEqual(history_path({"historyPath": str(chosen)}), chosen)
        self.assertEqual(history_path({"historyPath": "   "}), history_path({}))
        with patch.dict(os.environ, {"LOCALAPPDATA": r"C:\AppData\Local"}):
            self.assertEqual(
                history_path({}),
                Path(r"C:\AppData\Local") / "aura" / "history.sqlite",
            )


class RememberWindowTests(unittest.TestCase):
    def test_only_the_foreground_window_is_recorded(self) -> None:
        calls: list[tuple[str, str, str]] = []

        class Capture:
            def record_window(self, process_name: str, window_title: str, at: str) -> None:
                calls.append((process_name, window_title, at))

        window = ContextEvent(
            event_type="active_window_changed",
            source="active_window",
            data={"process_name": None, "window_title": "a.py"},
            timestamp="2026-11-07T18:00:00Z",
        )
        remember_window(Capture(), window)
        remember_window(
            Capture(),
            ContextEvent(
                event_type="scratchpad_changed",
                source="scratchpad",
                data={"text": "secret note", "path": "C:/Users/nggro/aura-scratch.md"},
            ),
        )
        self.assertEqual(calls, [("", "a.py", "2026-11-07T18:00:00Z")])

    def test_a_history_read_failure_stays_empty(self) -> None:
        class Boom:
            def get_process_history(self) -> dict:
                raise sqlite3.OperationalError("database is locked")

        self.assertEqual(read_process_history(None), {"recent": [], "frequent": []})
        with redirect_stdout(io.StringIO()) as output:
            self.assertEqual(read_process_history(Boom()), {"recent": [], "frequent": []})
        self.assertIn("History read failed", output.getvalue())

    def test_a_database_error_does_not_escape(self) -> None:
        class Boom:
            def record_window(self, process_name: str, window_title: str, at: str) -> None:
                raise sqlite3.OperationalError("database is locked")

        with redirect_stdout(io.StringIO()) as output:
            remember_window(
                Boom(),
                ContextEvent(
                    event_type="active_window_changed",
                    source="active_window",
                    data={"process_name": "Code.exe", "window_title": "a.py"},
                ),
            )
        self.assertIn("History write failed", output.getvalue())


class SimulatedHistoryTests(unittest.TestCase):
    def test_the_simulated_day_points_at_godot_after_code(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = seed_history(Path(folder) / "simulated.sqlite", ended_at=START)
            store = FocusStore(path)
            try:
                history = store.get_process_history(at=START.isoformat())
            finally:
                store.close()
        self.assertEqual(history["recent"][0]["process_name"], "Code.exe")
        self.assertEqual(history["recent"][0]["window_title"], "hud.gd - Visual Studio Code")
        self.assertEqual(history["frequent"][0]["process_name"], "Godot.exe")
        self.assertGreater(history["frequent"][0]["total_ms"], history["frequent"][1]["total_ms"])


if __name__ == "__main__":
    unittest.main()
