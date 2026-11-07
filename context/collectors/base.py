
# context/collectors/base.py

import threading
from collections.abc import Callable
from context.core.events import ContextEvent

Publish = Callable[[ContextEvent], None]


class Collector:
    """Base class for all desktop context collectors."""

    source = "base"

    def __init__(self) -> None:
        self.enabled = True
        self.publish: Publish | None = None
        self.thread = None

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled

    def emit(self, event: ContextEvent) -> None:
        """Send an event to the central context manager."""
        if self.enabled and self.publish is not None:
            self.publish(event)

    def start(self, publish):
        if self.thread and self.thread.is_alive():
            return

        self.publish = publish
        self.stop_event.clear()

        self.thread = threading.Thread(
            target=self._run,
            daemon=True
        )

        self.thread.start()

    def stop(self):
        self.stop_event.set()

        if self.thread and self.thread.is_alive():
            self.thread.join()

        self.thread = None
