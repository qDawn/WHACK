
import threading

try:
    import pyperclip
except ImportError:
    pyperclip = None

from context.core.events import ContextEvent
from context.collectors.base import Collector
from context.collectors.base import Publish
from context.platform.detect import detect_platform


class ClipboardCollector(Collector):
    source = "clipboard"

    def __init__(self) -> None:
        super().__init__()
        self.previous_state: tuple[str, str] | None = None
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def get_clipboard(self) -> None:
        if not self.enabled:
            return

        try:
            if pyperclip is None:
                raise RuntimeError("pyperclip is not installed")
            current_content = pyperclip.paste()
            content_type = "text" if current_content else "empty"
            text = current_content if content_type == "text" else ""
        except Exception:
            content_type = "unavailable"
            text = ""

        state = (content_type, text)
        if state == self.previous_state:
            return
        self.previous_state = state
        self.emit(
            ContextEvent(
                event_type="clipboard_changed",
                source=self.source,
                platform=detect_platform(),
                data={"content_type": content_type, "text": text},
            )
        )

    def _run(self) -> None:
        print("Clipboard thread started")
        while not self.stop_event.is_set():
            self.get_clipboard()
            self.stop_event.wait(0.5)
        print("Clipboard thread stopped")

    def start(self, publish: Publish) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.publish = publish
        self.stop_event.clear()
        self.thread = threading.Thread(
            target=self._run,
            daemon=True,
        )
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=2)
            self.thread = None