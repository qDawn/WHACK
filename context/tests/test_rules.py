import unittest

from context.core.models import ContextSnapshot
from bridge.rules import first_match


CONFIG = {
    "godotProject": "C:/games/platformer/project.godot",
    "gitRepo": "C:/code/platformer",
    "scratchpadPath": "C:/notes/scratch.md",
    "clipboardEnabled": True,
}

RULES = {
    "rules": [
        {
            "id": "godot-from-note",
            "when": {"noteContains": "platformer"},
            "suggest": {
                "kind": "open_godot",
                "title": "Open the Godot project",
                "target": "${godotProject}",
            },
        },
        {
            "id": "terminal-from-clipboard",
            "when": {"clipboardContains": "${gitRepo}"},
            "suggest": {
                "kind": "open_terminal",
                "title": "Open a terminal in the repo",
                "target": "${gitRepo}",
            },
        },
        {
            "id": "discord-from-note",
            "when": {"noteContains": "discord"},
            "suggest": {
                "kind": "focus_discord",
                "title": "Focus Discord",
                "target": "Discord",
            },
        },
    ]
}


def snapshot(note: str, clipboard: str | None = None) -> ContextSnapshot:
    return ContextSnapshot(
        platform="windows",
        clipboard_enabled=True,
        clipboard_text=clipboard,
        note_body=note,
        process_name="Notepad.exe",
        window_title="scratch.md",
    )


class RuleMatchTests(unittest.TestCase):
    def test_note_names_the_godot_project(self) -> None:
        suggestion = first_match(snapshot("keep going on the platformer"), RULES, CONFIG)
        self.assertIsNotNone(suggestion)
        assert suggestion is not None
        self.assertEqual(suggestion["title"], "Open the Godot project")
        self.assertEqual(suggestion["detail"], "C:/games/platformer/project.godot")
        self.assertEqual(suggestion["source"], "rule")

    def test_discord_note_matches_the_third_rule(self) -> None:
        suggestion = first_match(snapshot("ping discord about the build"), RULES, CONFIG)
        self.assertIsNotNone(suggestion)
        assert suggestion is not None
        self.assertEqual(suggestion["kind"], "focus_discord")

    def test_clipboard_repo_matches_when_the_note_does_not(self) -> None:
        suggestion = first_match(snapshot("hello", "see C:/code/platformer"), RULES, CONFIG)
        self.assertIsNotNone(suggestion)
        assert suggestion is not None
        self.assertEqual(suggestion["kind"], "open_terminal")

    def test_empty_context_has_no_suggestion(self) -> None:
        self.assertIsNone(first_match(snapshot("hello"), RULES, CONFIG))

    def test_website_in_note_suggests_opening_default_browser(self) -> None:
        suggestion = first_match(snapshot("todo: review https://example.com/docs."), RULES, CONFIG)
        self.assertIsNotNone(suggestion)
        assert suggestion is not None
        self.assertEqual(suggestion["kind"], "open_url")
        self.assertEqual(suggestion["target"], "https://example.com/docs")

    def test_www_link_is_normalized_to_https(self) -> None:
        suggestion = first_match(snapshot("read www.example.com/guide next"), RULES, CONFIG)
        self.assertIsNotNone(suggestion)
        assert suggestion is not None
        self.assertEqual(suggestion["target"], "https://www.example.com/guide")


if __name__ == "__main__":
    unittest.main()
