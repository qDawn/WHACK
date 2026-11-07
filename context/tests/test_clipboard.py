import unittest
from unittest.mock import patch

from context.collectors.clipboard import ClipboardCollector


class ClipboardCollectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.events = []
        self.collector = ClipboardCollector()
        self.collector.publish = self.events.append

    def test_publishes_only_when_clipboard_text_changes(self) -> None:
        with patch("context.collectors.clipboard.pyperclip", create=True) as clipboard:
            clipboard.paste.side_effect = ["first", "first", "second"]
            self.collector.get_clipboard()
            self.collector.get_clipboard()
            self.collector.get_clipboard()

        self.assertEqual(len(self.events), 2)
        self.assertEqual(self.events[-1].data, {"content_type": "text", "text": "second"})

    def test_empty_clipboard_has_empty_content_type(self) -> None:
        with patch("context.collectors.clipboard.pyperclip", create=True) as clipboard:
            clipboard.paste.return_value = ""
            self.collector.get_clipboard()

        self.assertEqual(self.events[0].data, {"content_type": "empty", "text": ""})

    def test_clipboard_error_is_published_without_ending_the_collector(self) -> None:
        with patch("context.collectors.clipboard.pyperclip", create=True) as clipboard:
            clipboard.paste.side_effect = RuntimeError("unavailable")
            self.collector.get_clipboard()

        self.assertEqual(self.events[0].data, {"content_type": "unavailable", "text": ""})

    def test_disabled_collector_does_not_read_or_publish(self) -> None:
        self.collector.set_enabled(False)
        with patch("context.collectors.clipboard.pyperclip", create=True) as clipboard:
            self.collector.get_clipboard()

        clipboard.paste.assert_not_called()
        self.assertEqual(self.events, [])


if __name__ == "__main__":
    unittest.main()