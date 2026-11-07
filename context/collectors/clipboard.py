
import threading
import pyperclip

from context.collectors.base import Collector
from context.core.events import ContextEvent


class ClipboardCollector(Collector):
    source = "clipboard"

    def __init__(self):
        super().__init__()

        self.previous_content = ""
        self.stop_event = threading.Event()
        self.thread = None

    def get_clipboard(self):
        if not self.enabled:
            return

        try:
            current_content = pyperclip.paste()

            if current_content != self.previous_content:
                self.previous_content = current_content

                event = ContextEvent(
                    event_type="clipboard_changed",
                    source=self.source,
                    data={
                        "content_type": "text",
                        "text": current_content
                    }
                )

                self.emit(event)

        except Exception as e:
            print(f"Clipboard error: {e}")

    def _run(self):
        print("Clipboard thread started")

        while not self.stop_event.is_set():
            self.get_clipboard()
            self.stop_event.wait(0.5)

        print("Clipboard thread stopped")
