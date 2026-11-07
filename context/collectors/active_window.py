"""Foreground window collector.

Publish active_window_changed when the process name or window title changes.
Windows calls context.platform.windows.active_window.foreground_window.
Linux calls the stub in context.platform.linux.active_window.
"""

import threading

from context.collectors.base import Collector, Publish
from context.core.events import ContextEvent
from context.platform.detect import detect_platform


# The dashboard's own window. Showing it must not wipe the window the user was in.
_OWN_PROCESSES = {"hud.exe", "aura.exe"}


class ActiveWindowCollector(Collector):
    source = "active_window"

    def __init__(self, interval: float = 0.4) -> None:
        super().__init__()
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._previous: tuple[str, str] | None = None
        self._reported_failure = False

    def start(self, publish: Publish) -> None:
        self.publish = publish
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def _loop(self) -> None:
        while not self._stop.is_set():
            if self.enabled:
                self._poll()
            self._stop.wait(self.interval)

    def _poll(self) -> None:
        try:
            current = _foreground()
        except Exception:
            if not self._reported_failure:
                print("Active window unavailable", flush=True)
                self._reported_failure = True
            return
        self._reported_failure = False
        process_name, window_title = current
        if process_name.casefold() in _OWN_PROCESSES:
            return
        if current == self._previous:
            return
        self._previous = current
        self.emit(
            ContextEvent(
                event_type="active_window_changed",
                source=self.source,
                data={"process_name": process_name, "window_title": window_title},
            )
        )


def _foreground() -> tuple[str, str]:
    platform = detect_platform()
    if platform == "windows":
        from context.platform.windows.active_window import foreground_window
    elif platform == "linux":
        from context.platform.linux.active_window import foreground_window
    else:
        return "", ""
    return foreground_window()
