import tempfile
import time
import unittest
from pathlib import Path

from context.collectors.scratchpad import ScratchpadCollector
from context.core.manager import ContextManager


class ScratchpadCollectorTests(unittest.TestCase):
    def test_publish_when_the_note_is_saved(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            note = Path(folder) / "scratch.md"
            note.write_text("keep going on the platformer", encoding="utf-8")
            manager = ContextManager(platform="windows")
            collector = ScratchpadCollector(note, interval=0.05)
            collector.start(manager.publish)
            try:
                deadline = time.time() + 2
                while manager.snapshot().note_body == "" and time.time() < deadline:
                    time.sleep(0.05)
                self.assertEqual(manager.snapshot().note_body, "keep going on the platformer")

                note.write_text("ping discord about the build", encoding="utf-8")
                deadline = time.time() + 2
                while "discord" not in manager.snapshot().note_body and time.time() < deadline:
                    time.sleep(0.05)
                self.assertEqual(manager.snapshot().note_body, "ping discord about the build")
            finally:
                collector.stop()


if __name__ == "__main__":
    unittest.main()
