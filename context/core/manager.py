from collections.abc import Callable

from context.core.events import ContextEvent
from context.core.models import ContextSnapshot
from context.platform.detect import detect_platform

Subscriber = Callable[[ContextEvent, ContextSnapshot], None]

HUD_EVENT_TYPES = {
    "clipboard_changed",
    "active_window_changed",
    "scratchpad_changed",
}


class ContextManager:
    """In-process store. Collectors publish events. The dashboard reads snapshots."""

    def __init__(self, platform: str | None = None, clipboard_enabled: bool = True) -> None:
        self.snapshot_value = ContextSnapshot(
            platform=platform or detect_platform(),
            clipboard_enabled=clipboard_enabled,
        )
        self.snapshot_value.touch()
        self._subscribers: list[Subscriber] = []

    def snapshot(self) -> ContextSnapshot:
        return self.snapshot_value

    def subscribe(self, callback: Subscriber) -> None:
        self._subscribers.append(callback)

    def set_clipboard_enabled(self, enabled: bool) -> None:
        snap = self.snapshot_value
        snap.clipboard_enabled = enabled
        if not enabled:
            snap.clipboard_text = None
            snap.clipboard_content_type = "disabled"
        snap.touch()

    def publish(self, event: ContextEvent) -> None:
        self._apply(event)
        snap = self.snapshot_value
        for callback in list(self._subscribers):
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
            snap.process_name = str(data.get("process_name", ""))
            snap.window_title = str(data.get("window_title", ""))
        elif event.event_type == "scratchpad_changed":
            snap.note_body = str(data.get("text", ""))
        elif event.event_type not in HUD_EVENT_TYPES:
            # Screen and process events are accepted and ignored by the HUD.
            pass
        else:
            return
        snap.touch()
