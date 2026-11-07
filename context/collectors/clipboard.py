import ctypes
import sys
import threading
from ctypes import wintypes

import pyperclip

from context.collectors.base import Collector, Publish
from context.core.events import ContextEvent

CF_TEXT = 1
CF_UNICODETEXT = 13
_user32 = None
_user32_ready = threading.Lock()


class ClipboardCollector(Collector):
    source = "clipboard"

    def __init__(self) -> None:
        super().__init__()
        self._previous: tuple[str, str] | None = None
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self, publish: Publish) -> None:
        self.publish = publish
        if self.thread and self.thread.is_alive():
            return

        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=2)
            self.thread = None

    def _run(self) -> None:
        while not self.stop_event.is_set():
            if self.enabled:
                self._poll()
            self.stop_event.wait(0.5)

    def _poll(self) -> None:
        content_type, text = _read_clipboard()
        current = (content_type, text if content_type == "text" else "")
        if current == self._previous:
            return
        self._previous = current
        print(f"Clipboard used ({content_type})", flush=True)
        self.emit(
            ContextEvent(
                event_type="clipboard_changed",
                source=self.source,
                data={"content_type": content_type, "text": current[1]},
            )
        )


def _read_clipboard() -> tuple[str, str]:
    try:
        if sys.platform.startswith("win"):
            kind = _windows_clipboard_kind()
            if kind != "text":
                return kind, ""
        text = pyperclip.paste()
    except Exception:
        print("Clipboard unavailable", flush=True)
        return "unavailable", ""
    if text is None:
        return "unavailable", ""
    if text == "":
        return "empty", ""
    return "text", text


def _windows_user32() -> ctypes.WinDLL:
    global _user32
    with _user32_ready:
        if _user32 is None:
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            user32.OpenClipboard.argtypes = [wintypes.HWND]
            user32.OpenClipboard.restype = wintypes.BOOL
            user32.CloseClipboard.argtypes = []
            user32.CloseClipboard.restype = wintypes.BOOL
            user32.IsClipboardFormatAvailable.argtypes = [wintypes.UINT]
            user32.IsClipboardFormatAvailable.restype = wintypes.BOOL
            user32.CountClipboardFormats.argtypes = []
            user32.CountClipboardFormats.restype = ctypes.c_int
            _user32 = user32
        return _user32


def _windows_clipboard_kind() -> str:
    user32 = _windows_user32()
    if not user32.OpenClipboard(None):
        return "unavailable"
    try:
        if user32.IsClipboardFormatAvailable(CF_UNICODETEXT) or user32.IsClipboardFormatAvailable(CF_TEXT):
            return "text"
        if user32.CountClipboardFormats() == 0:
            return "empty"
        return "non_text"
    finally:
        user32.CloseClipboard()
