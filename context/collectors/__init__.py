from context.collectors.active_window import ActiveWindowCollector
from context.collectors.base import Collector
from context.collectors.clipboard import ClipboardCollector
from context.collectors.processes import ProcessCollector
from context.collectors.screen import ScreenCollector
from context.collectors.scratchpad import ScratchpadCollector

__all__ = [
    "ActiveWindowCollector",
    "ClipboardCollector",
    "Collector",
    "ProcessCollector",
    "ScreenCollector",
    "ScratchpadCollector",
]
