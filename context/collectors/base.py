
# context/collectors/base.py

from collections.abc import Callable
from context.core.events import ContextEvent

Publish = Callable[[ContextEvent], None]


class Collector:
    """Base class for all desktop context collectors."""

    source = "base"

    def __init__(self) -> None:
        self.enabled = True
        self.publish: Publish | None = None

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled

    def emit(self, event: ContextEvent) -> None:
        """Send an event to the central context manager."""
        if self.enabled and self.publish is not None:
            self.publish(event)

    def start(self, publish: Publish) -> None:
        """Start the collector and give it an event publisher."""
        raise NotImplementedError

    def stop(self) -> None:
        raise NotImplementedError
