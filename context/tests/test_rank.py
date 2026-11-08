import unittest

from bridge.rank import kind_for_process, top_cards


ACTIONS = [
    {"kind": "open_godot", "title": "Godot", "detail": "project"},
    {"kind": "open_terminal", "title": "Terminal", "detail": "repo"},
    {"kind": "focus_discord", "title": "Discord", "detail": "Discord"},
    {"kind": "open_vscode", "title": "Visual Studio Code", "detail": "Visual Studio Code"},
    {"kind": "open_firefox", "title": "Firefox", "detail": "Firefox"},
    {"kind": "open_chrome", "title": "Chrome", "detail": "Google Chrome"},
]


class RankTests(unittest.TestCase):
    def test_process_names_map_onto_cards(self) -> None:
        self.assertEqual(kind_for_process("Godot_v4.5-stable_win64.exe"), "open_godot")
        self.assertEqual(kind_for_process("Code.exe"), "open_vscode")
        self.assertIsNone(kind_for_process("hud.exe"))

    def test_top_three_are_the_rule_then_the_history(self) -> None:
        history = {
            "frequent": [
                {"process_name": "Godot.exe"},
                {"process_name": "Code.exe"},
                {"process_name": "chrome.exe"},
            ],
            "recent": [{"process_name": "Discord.exe"}],
        }
        shown = top_cards(
            ACTIONS,
            {"kind": "open_firefox", "title": "Open Firefox"},
            history,
        )
        self.assertEqual(
            [card["kind"] for card in shown],
            ["open_firefox", "open_godot", "open_vscode"],
        )

    def test_empty_history_without_a_suggestion_returns_nothing(self) -> None:
        self.assertEqual(top_cards(ACTIONS, None, {"frequent": [], "recent": []}), [])
        self.assertEqual(top_cards(ACTIONS, None, None), [])

    def test_a_suggestion_without_history_is_not_padded(self) -> None:
        shown = top_cards(
            ACTIONS,
            {"kind": "open_firefox", "title": "Open Firefox"},
            {"frequent": [], "recent": []},
        )
        self.assertEqual([card["kind"] for card in shown], ["open_firefox"])

    def test_an_unknown_suggestion_does_not_borrow_catalog_cards(self) -> None:
        shown = top_cards(
            ACTIONS,
            {"kind": "not_a_card"},
            {"frequent": [{"process_name": "hud.exe"}], "recent": []},
        )
        self.assertEqual(shown, [])

    def test_longer_history_returns_more_than_three_and_at_most_the_limit(self) -> None:
        history = {
            "frequent": [
                {"process_name": "Godot.exe"},
                {"process_name": "Code.exe"},
                {"process_name": "chrome.exe"},
                {"process_name": "firefox.exe"},
            ],
            "recent": [{"process_name": "Discord.exe"}, {"process_name": "Godot.exe"}],
        }
        capped = [card["kind"] for card in top_cards(ACTIONS, None, history, limit=4)]
        self.assertGreater(len(capped), 3)
        self.assertLessEqual(len(capped), 4)
        self.assertEqual(capped, ["open_godot", "open_vscode", "open_chrome", "open_firefox"])

        wider = [card["kind"] for card in top_cards(ACTIONS, None, history, limit=8)]
        self.assertGreater(len(wider), 3)
        self.assertLessEqual(len(wider), 8)
        self.assertEqual(
            wider,
            ["open_godot", "open_vscode", "open_chrome", "open_firefox", "focus_discord"],
        )


if __name__ == "__main__":
    unittest.main()
