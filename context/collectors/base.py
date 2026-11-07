from collections.abc import Callable

from context.core.events import ContextEvent

Publish = Callable[[ContextEvent], None]


class Collector:
    """Long-running desktop listener. `start` returns after the loop is armed.

    The loop itself runs on a thread the collector owns. `stop` ends that loop.
    """

    source = "base"

    def __init__(self) -> None:
        self.enabled = True

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled

    def start(self, publish: Publish) -> None:
        raise NotImplementedError

    def stop(self) -> None:
        raise NotImplementedError
