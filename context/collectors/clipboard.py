"""Clipboard collector. Owned by the context workstream.

Read text with pyperclip. Poll about twice a second. Publish
clipboard_changed only when the text actually changes. Skip paste() while
`enabled` is false. Do not print the clipboard text.
"""

from context.collectors.base import Collector


class ClipboardCollector(Collector):
    source = "clipboard"

    def start(self, publish) -> None:
        raise NotImplementedError("ClipboardCollector.start belongs to the context workstream")

    def stop(self) -> None:
        raise NotImplementedError("ClipboardCollector.stop belongs to the context workstream")
