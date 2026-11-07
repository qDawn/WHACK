import unittest

from bridge.launch import cards, load_entries, parse_action, perform


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
        self.assertEqual([entry["id"] for entry in loaded], ["open_godot", "open_terminal", "focus_discord"])

    def test_file_entry_refuses_a_missing_path(self) -> None:
        with self.assertRaises(FileNotFoundError):
            perform("open_godot", CONFIG, ENTRIES)


if __name__ == "__main__":
    unittest.main()
