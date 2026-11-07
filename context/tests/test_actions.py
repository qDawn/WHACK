import unittest

from bridge.launch import catalog, parse_action


class ActionTests(unittest.TestCase):
    def test_catalog_lists_the_three_cards(self) -> None:
        cards = catalog(
            {
                "godotProject": "C:/games/platformer/project.godot",
                "gitRepo": "C:/code/platformer",
            }
        )
        self.assertEqual([card["kind"] for card in cards], ["open_godot", "open_terminal", "focus_discord"])
        self.assertEqual(cards[0]["detail"], "C:/games/platformer/project.godot")

    def test_parse_known_action(self) -> None:
        self.assertEqual(parse_action('{"kind":"open_terminal"}'), "open_terminal")

    def test_parse_rejects_unknown_action(self) -> None:
        with self.assertRaises(ValueError):
            parse_action('{"kind":"delete_disk"}')


if __name__ == "__main__":
    unittest.main()
