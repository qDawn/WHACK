import unittest

from context.core.events import ContextEvent
from context.core.manager import ContextManager
from bridge.state_snapshot import to_state_snapshot


class ContextManagerTests(unittest.TestCase):
    def test_window_and_note_reach_the_hud_message(self) -> None:
        manager = ContextManager(platform="windows", clipboard_enabled=True)
        manager.publish(
            ContextEvent(
                event_type="active_window_changed",
                source="active_window",
                platform="windows",
                data={"process_name": "Notepad.exe", "window_title": "aura-scratch.md"},
            )
        )
        manager.publish(
            ContextEvent(
                event_type="scratchpad_changed",
                source="scratchpad",
                platform="windows",
                data={"path": "C:/Users/nggro/aura-scratch.md", "text": "keep going on the platformer"},
            )
        )

        message = to_state_snapshot(manager.snapshot(), run_id="demo-1")
        self.assertEqual(message["protocol"], "ag-ui")
        self.assertEqual(message["type"], "STATE_SNAPSHOT")
        self.assertEqual(message["payload"]["process"], "Notepad.exe")
        self.assertEqual(message["payload"]["title"], "aura-scratch.md")
        self.assertEqual(message["payload"]["noteBody"], "keep going on the platformer")
        self.assertNotIn("suggestion", message["payload"])

    def test_disabled_clipboard_drops_text(self) -> None:
        manager = ContextManager(platform="windows", clipboard_enabled=False)
        manager.publish(
            ContextEvent(
                event_type="clipboard_changed",
                source="clipboard",
                platform="windows",
                data={"content_type": "text", "text": "secret token"},
            )
        )
        snap = manager.snapshot()
        self.assertIsNone(snap.clipboard_text)
        self.assertFalse(snap.clipboard_enabled)

    def test_screen_event_does_not_change_hud_fields(self) -> None:
        manager = ContextManager(platform="linux")
        manager.publish(
            ContextEvent(
                event_type="screen_captured",
                source="screen",
                platform="linux",
                data={"path": "/tmp/screen.png", "width": 10, "height": 10},
            )
        )
        snap = manager.snapshot()
        self.assertEqual(snap.process_name, "")
        self.assertIsNone(snap.clipboard_text)

    def test_agent_context_serializes_snapshot_and_event(self) -> None:
        manager = ContextManager(platform="windows")
        manager.publish(
            ContextEvent(
                event_type="active_window_changed",
                source="active_window",
                platform="windows",
                data={"process_name": "Code.exe", "window_title": "Aura"},
            )
        )

        context = manager.agent_context()
        self.assertEqual(context["current_context"]["process_name"], "Code.exe")
        self.assertEqual(context["recent_events"][0]["platform"], "windows")


if __name__ == "__main__":
    unittest.main()
