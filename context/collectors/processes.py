"""Optional process-list collector. Owned by the context workstream.

Not required for the demo. Publish processes_updated with names and pids.
The dashboard snapshot does not include this list.
"""

from context.collectors.base import Collector


class ProcessCollector(Collector):
    source = "processes"

    def start(self, publish) -> None:
        raise NotImplementedError("ProcessCollector is optional and not on the demo path")

    def stop(self) -> None:
        raise NotImplementedError
