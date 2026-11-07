import json
import sys
import threading
import time
import unittest

from bridge.pipe_server import PIPE_NAME, serve


class PipeServerTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform.startswith("win"), "Windows named pipes only")
    def test_panel_can_read_one_line(self) -> None:
        message = json.dumps(
            {"protocol": "ag-ui", "payload": {"suggestion": {"title": "Open the Godot project"}}}
        )
        stop = threading.Event()
        thread = threading.Thread(target=serve, args=(lambda: message, stop), daemon=True)
        thread.start()
        try:
            deadline = time.time() + 3
            line = ""
            while time.time() < deadline and not line:
                try:
                    with open(PIPE_NAME, encoding="utf-8") as pipe:
                        line = pipe.readline().strip()
                except OSError:
                    time.sleep(0.1)
            self.assertIn("Open the Godot project", line)
        finally:
            stop.set()


if __name__ == "__main__":
    unittest.main()
