"""Optional screenshot collector. Owned by the context workstream.

Not required for the demo. If implemented, publish screen_captured with a
local file path. Do not put image bytes in the event.
"""

from context.collectors.base import Collector


class ScreenCollector(Collector):
    source = "screen"

    def start(self, publish) -> None:
        raise NotImplementedError("ScreenCollector is optional and not on the demo path")

    def stop(self) -> None:
        raise NotImplementedError
