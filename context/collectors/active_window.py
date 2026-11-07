"""Foreground window collector. Owned by the context workstream.

Publish active_window_changed when the process name or window title changes.
Call context.platform.windows.active_window.foreground_window on Windows and
context.platform.linux.active_window.foreground_window on Linux.
"""

from context.collectors.base import Collector


class ActiveWindowCollector(Collector):
    source = "active_window"

    def start(self, publish) -> None:
        raise NotImplementedError("ActiveWindowCollector.start belongs to the context workstream")

    def stop(self) -> None:
        raise NotImplementedError("ActiveWindowCollector.stop belongs to the context workstream")
