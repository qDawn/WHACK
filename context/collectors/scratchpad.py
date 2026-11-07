"""Single markdown scratchpad. Owned by the dashboard workstream.

Watch aura.config.json -> scratchpadPath. Publish scratchpad_changed with
the full file text when it changes. The context workstream does not implement this.
"""

from context.collectors.base import Collector


class ScratchpadCollector(Collector):
    source = "scratchpad"

    def start(self, publish) -> None:
        raise NotImplementedError("ScratchpadCollector.start belongs to the dashboard workstream")

    def stop(self) -> None:
        raise NotImplementedError("ScratchpadCollector.stop belongs to the dashboard workstream")
