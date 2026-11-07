import threading

from context.core.manager import ContextManager
from context.collectors.clipboard import ClipboardCollector
from context.collectors.active_window import ActiveWindowCollector
from context.collectors.processes import ProcessCollector


manager = ContextManager()

manager.register_collector(ClipboardCollector())
manager.register_collector(ActiveWindowCollector())
manager.register_collector(ProcessCollector())

def on_context_event(event, snapshot):
    print(event)


manager.subscribe(on_context_event)

manager.start()

print("Context monitoring started. Press Ctrl+C to stop.")

try:
    while True:
        threading.Event().wait(1)

except KeyboardInterrupt:
    print("\nStopping context manager...")
    manager.stop()
    print("Context monitoring stopped.")