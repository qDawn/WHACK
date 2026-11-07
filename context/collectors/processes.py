
import threading

import psutil

from context.collectors.base import Collector
from context.core.events import ContextEvent


class ProcessCollector(Collector):
    source = "processes"

    def __init__(self, poll_interval=2.0):
        super().__init__()

        self.poll_interval = poll_interval
        self.previous_processes = None
        self.stop_event = threading.Event()
        self.thread = None

    def get_processes(self):
        processes = []

        for process in psutil.process_iter(
            ["pid", "name", "exe", "status", "create_time"]
        ):
            try:
                info = process.info

                processes.append({
                    "pid": info["pid"],
                    "name": info["name"],
                    "exe": info["exe"],
                    "status": info["status"],
                    "create_time": info["create_time"],
                })

            except (
                psutil.NoSuchProcess,
                psutil.AccessDenied,
                psutil.ZombieProcess,
            ):
                continue

        return sorted(processes, key=lambda p: p["pid"])

    def check_processes(self):
        if not self.enabled:
            return

        try:
            current_processes = self.get_processes()

            # Only publish when the process snapshot changes.
            if current_processes != self.previous_processes:
                self.previous_processes = current_processes

                event = ContextEvent(
                    event_type="processes_changed",
                    source=self.source,
                    data={
                        "processes": current_processes,
                        "count": len(current_processes),
                    }
                )

                self.emit(event)

        except Exception as e:
            print(f"Process collector error: {e}")

    def _run(self):
        print("Process collector started")

        while not self.stop_event.is_set():
            self.check_processes()
            self.stop_event.wait(self.poll_interval)

        print("Process collector stopped")
