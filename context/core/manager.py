
# context/core/manager.py

from collections import deque
from collections.abc import Callable
from dataclasses import replace
from threading import RLock

from context.core.events import ContextEvent
from context.core.models import ContextSnapshot
from context.platform.detect import detect_platform
from context.collectors.base import Collector

Subscriber = Callable[[ContextEvent, ContextSnapshot], None]

HUD_EVENT_TYPES = {
    "clipboard_changed",
    "active_window_changed",
    "scratchpad_changed",
}


class ContextManager:
    """Central store for desktop context and collector lifecycle."""

    def __init__(
        self,
        platform: str | None = None,
        clipboard_enabled: bool = True,
        history_limit: int = 100,
    ) -> None:

        self.snapshot_value = ContextSnapshot(
            platform=platform or detect_platform(),
            clipboard_enabled=clipboard_enabled,
        )

        self.snapshot_value.touch()

        self._subscribers: list[Subscriber] = []
        self._collectors: list[Collector] = []
        self._history = deque(maxlen=history_limit)
        self._lock = RLock()
        self._running = False

    # -------------------------
    # Collector management
    # -------------------------

    def register_collector(self, collector: Collector) -> None:
        self._collectors.append(collector)

    def start(self) -> None:
        if self._running:
            return

        self._running = True

        for collector in self._collectors:
            collector.start(self.publish)

    def stop(self) -> None:
        if not self._running:
            return

        for collector in self._collectors:
            try:
                collector.stop()
            except Exception as exc:
                print(f"Collector stop failed: {exc}", flush=True)

        self._running = False

    # -------------------------
    # Snapshot and subscribers
    # -------------------------

    def snapshot(self) -> ContextSnapshot:
        with self._lock:
            return replace(self.snapshot_value)

    def subscribe(self, callback: Subscriber) -> None:
        self._subscribers.append(callback)

    def set_clipboard_enabled(self, enabled: bool) -> None:
        with self._lock:
            self.snapshot_value.clipboard_enabled = enabled

            for collector in self._collectors:
                if collector.source == "clipboard":
                    collector.set_enabled(enabled)

            if not enabled:
                self.snapshot_value.clipboard_text = None
                self.snapshot_value.clipboard_content_type = "disabled"

            self.snapshot_value.touch()

    # -------------------------
    # Event processing
    # -------------------------

    def publish(self, event: ContextEvent) -> None:
        with self._lock:
            self._apply(event)

            self._history.append(event)

            snap = replace(self.snapshot_value)
            subscribers = list(self._subscribers)

            # Stay ordered: a slower collector must not overwrite a newer snapshot.
            for callback in subscribers:
                callback(event, snap)

    def _apply(self, event: ContextEvent) -> None:
        snap = self.snapshot_value
        data = event.data

        if event.event_type == "clipboard_changed":
            content_type = str(data.get("content_type", "text"))

            snap.clipboard_content_type = content_type

            if snap.clipboard_enabled and content_type == "text":
                snap.clipboard_text = str(data.get("text", ""))
            else:
                snap.clipboard_text = None

        elif event.event_type == "active_window_changed":
            snap.process_name = str(data.get("process_name") or "")
            snap.window_title = str(data.get("window_title") or "")

        elif event.event_type == "scratchpad_changed":
            snap.note_body = str(data.get("text", ""))

        snap.touch()

    # -------------------------
    # Agent context
    # -------------------------

    def agent_context(self) -> dict:
        """Return a serialisable context object for the AI agent."""

        with self._lock:
            return {
                "current_context": self.snapshot_value.to_dict(),
                "recent_events": [
                    event.to_dict()
                    for event in self._history
                ],
            }
