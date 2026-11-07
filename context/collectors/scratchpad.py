"""Watch the one scratchpad file from aura.config.json."""

from collections.abc import Callable
from pathlib import Path
import threading

from context.collectors.base import Publish
from context.core.events import ContextEvent
from context.platform.detect import detect_platform


class ScratchpadCollector:
    """Publish scratchpad_changed when the note text changes.

    The collector owns its thread. start returns after that thread is running.
    """

    source = "scratchpad"

    def __init__(self, path: Path, interval: float = 0.4) -> None:
        self.path = path
        self.interval = interval
        self.enabled = True
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled

    def start(self, publish: Publish) -> None:
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, args=(publish,), daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def _loop(self, publish: Callable[[ContextEvent], None]) -> None:
        previous: str | None = None
        while not self._stop.is_set():
            if self.enabled:
                text = self._read()
                if text is not None and text != previous:
                    previous = text
                    publish(
                        ContextEvent(
                            event_type="scratchpad_changed",
                            source=self.source,
                            platform=detect_platform(),
                            data={"path": str(self.path), "text": text},
                        )
                    )
            self._stop.wait(self.interval)

    def _read(self) -> str | None:
        try:
            return self.path.read_text(encoding="utf-8")
        except (FileNotFoundError, OSError):
            return None
