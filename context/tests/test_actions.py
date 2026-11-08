import unittest

from bridge.launch import _arguments, _directory_fallback, cards, load_entries, parse_action, perform
from bridge.rules import ROOT, load_json
from bridge.watch import accept_action


ENTRIES = [
    {
        "id": "open_godot",
        "title": "Godot",
        "detail": "${godotProject}",
        "method": "file",
        "target": "${godotProject}",
    },
    {
        "id": "open_terminal",
        "title": "Terminal",
        "detail": "${gitRepo}",
        "method": "command",
        "command": ["wt.exe", "-d", "${gitRepo}"],
    },
    {
        "id": "focus_discord",
        "title": "Discord",
        "detail": "Discord",
        "method": "link",
        "target": "discord:",
    },
]

CONFIG = {
    "godotProject": "C:/games/platformer/project.godot",
    "gitRepo": "C:/code/platformer",
}


class ActionTests(unittest.TestCase):
    def test_catalog_lists_the_three_cards(self) -> None:
        shown = cards(ENTRIES, CONFIG)
        self.assertEqual([card["kind"] for card in shown], ["open_godot", "open_terminal", "focus_discord"])
        self.assertEqual(shown[0]["detail"], "C:/games/platformer/project.godot")

    def test_parse_known_action(self) -> None:
        self.assertEqual(parse_action('{"kind":"open_terminal"}', ENTRIES), "open_terminal")

    def test_parse_rejects_unknown_action(self) -> None:
        with self.assertRaises(ValueError):
            parse_action('{"kind":"delete_disk"}', ENTRIES)

    def test_project_catalog_loads(self) -> None:
        loaded = load_entries()
        ids = [entry["id"] for entry in loaded]
        self.assertGreaterEqual(len(ids), 24)
        self.assertEqual(len(ids), len(set(ids)))
        for entry in loaded:
            self.assertIn(entry["method"], ("file", "command", "link"))
        self.assertEqual(ids[:4], ["open_godot", "open_godot_editor", "open_terminal", "focus_discord"])
        shipped = load_json(ROOT / "aura.config.json")
        godot = next(entry for entry in loaded if entry["id"] == "open_godot")
        resolved = _arguments(godot["command"], shipped)
        self.assertEqual(resolved[1:3], ["--editor", "--path"])
        self.assertTrue(resolved[3].endswith("Game-Dev-Coursework"))

    def test_terminal_falls_back_when_the_repo_directory_is_missing(self) -> None:
        entry = {
            "command": ["wt.exe", "-d", "${gitRepo}"],
            "fallback": ["powershell.exe", "-NoExit", "-Command", "Set-Location -LiteralPath '${gitRepo}'"],
            "directoryFallback": "C:/Users/nggro",
        }
        config = {"gitRepo": "C:/missing/platformer"}
        command = _directory_fallback(entry, _arguments(entry["command"], config), config)
        fallback = _directory_fallback(entry, _arguments(entry["fallback"], config), config)
        self.assertEqual(command, ["wt.exe", "-d", "C:/Users/nggro"])
        self.assertEqual(fallback[-1], "Set-Location -LiteralPath 'C:/Users/nggro'")

    def test_terminal_keeps_a_repo_directory_that_exists(self) -> None:
        entry = {
            "command": ["wt.exe", "-d", "${gitRepo}"],
            "directoryFallback": "C:/Users/nggro",
        }
        config = {"gitRepo": "C:/Windows"}
        command = _directory_fallback(entry, _arguments(entry["command"], config), config)
        self.assertEqual(command, ["wt.exe", "-d", "C:/Windows"])

    def test_commands_without_a_directory_fallback_keep_a_missing_path(self) -> None:
        entry = {"command": ["explorer.exe", "${gitRepo}"]}
        config = {"gitRepo": "C:/missing/platformer"}
        command = _directory_fallback(entry, _arguments(entry["command"], config), config)
        self.assertEqual(command, ["explorer.exe", "C:/missing/platformer"])

    def test_file_entry_refuses_a_missing_path(self) -> None:
        with self.assertRaises(FileNotFoundError):
            perform("open_godot", CONFIG, ENTRIES)

    def test_hud_shown_does_not_call_perform(self) -> None:
        launched: list[str] = []
        shown: list[int] = []

        def perform_fn(*args, **kwargs):
            launched.append("launch")

        def on_shown() -> None:
            shown.append(1)

        outcome = accept_action(
            '{"protocol":"aura","type":"hud.shown"}',
            ENTRIES,
            CONFIG,
            "https://example.com",
            perform_fn,
            on_shown,
        )
        self.assertEqual(outcome, "shown")
        self.assertEqual(launched, [])
        self.assertEqual(shown, [1])

        outcome = accept_action(
            '{"protocol":"aura","type":"hud.shown","kind":"open_godot"}',
            ENTRIES,
            CONFIG,
            "",
            perform_fn,
            on_shown,
        )
        self.assertEqual(outcome, "shown")
        self.assertEqual(launched, [])
        self.assertEqual(shown, [1, 1])

        def launch_kind(kind, config, entries, target=None):
            launched.append(kind)

        self.assertEqual(
            accept_action('{"kind":"open_terminal"}', ENTRIES, CONFIG, "", launch_kind, on_shown),
            "open_terminal",
        )
        self.assertEqual(launched, ["open_terminal"])
        self.assertEqual(shown, [1, 1])


if __name__ == "__main__":
    unittest.main()
