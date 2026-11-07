
import threading

from context.collectors.base import Collector
from context.core.events import ContextEvent
from context.platform.detect import detect_platform


class ActiveWindowCollector(Collector):
    source = "active_window"

    def __init__(self, poll_interval=0.5):
        super().__init__()

        self.poll_interval = poll_interval
        self.previous_window = None
        self.stop_event = threading.Event()
        self.thread = None
        if detect_platform() == "windows":
            from context.platform.windows.active_window import get_active_window
        else:
            from context.platform.linux.active_window import get_active_window
        self._get_active_window = get_active_window

    def check_active_window(self):
        if not self.enabled:
            return

        try:
            current_window = self._get_active_window()

            if current_window is None:
                return

            current_context = (
                current_window.get("window_id"),
                current_window.get("window_title"),
                current_window.get("process_id"),
                current_window.get("process_name"),
            )

            if current_context != self.previous_window:
                self.previous_window = current_context

                event = ContextEvent(
                    event_type="active_window_changed",
                    source=self.source,
                    data=current_window
                )

                self.emit(event)

        except Exception as e:
            print(f"Active window error: {e}")

    def _run(self):
        print("Active window collector started")

        while not self.stop_event.is_set():
            self.check_active_window()
            self.stop_event.wait(self.poll_interval)

        print("Active window collector stopped")

    def start(self, publish):
        if self.thread and self.thread.is_alive():
            return

        self.publish = publish
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join()
        self.thread = None

