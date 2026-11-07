"""Windows named pipe the Aura panel reads.

One JSON object per line. The pipe is \\.\\pipe\\aura.
"""

from collections.abc import Callable
import ctypes
from ctypes import wintypes
import sys
import threading

PIPE_NAME = r"\\.\pipe\aura"
PIPE_ACCESS_OUTBOUND = 0x00000002
PIPE_TYPE_BYTE = 0x00000000
PIPE_WAIT = 0x00000000
ERROR_PIPE_CONNECTED = 535
INVALID_HANDLE = wintypes.HANDLE(-1).value

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.CreateNamedPipeW.argtypes = [
    wintypes.LPCWSTR,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    ctypes.c_void_p,
]
kernel32.CreateNamedPipeW.restype = wintypes.HANDLE
kernel32.ConnectNamedPipe.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
kernel32.ConnectNamedPipe.restype = wintypes.BOOL
kernel32.WriteFile.argtypes = [
    wintypes.HANDLE,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(wintypes.DWORD),
    ctypes.c_void_p,
]
kernel32.WriteFile.restype = wintypes.BOOL
kernel32.FlushFileBuffers.argtypes = [wintypes.HANDLE]
kernel32.FlushFileBuffers.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.restype = wintypes.BOOL


def _create_pipe() -> wintypes.HANDLE:
    handle = kernel32.CreateNamedPipeW(
        PIPE_NAME,
        PIPE_ACCESS_OUTBOUND,
        PIPE_TYPE_BYTE | PIPE_WAIT,
        1,
        65536,
        65536,
        0,
        None,
    )
    if handle == INVALID_HANDLE or handle is None:
        raise OSError(ctypes.get_last_error(), "CreateNamedPipeW failed")
    return handle


def _connect(handle: wintypes.HANDLE) -> bool:
    connected = kernel32.ConnectNamedPipe(handle, None)
    if connected:
        return True
    return ctypes.get_last_error() == ERROR_PIPE_CONNECTED


def _write_line(handle: wintypes.HANDLE, line: str) -> bool:
    payload = (line + "\n").encode("utf-8")
    buffer = ctypes.create_string_buffer(payload)
    written = wintypes.DWORD(0)
    ok = kernel32.WriteFile(handle, buffer, len(payload), ctypes.byref(written), None)
    if not ok:
        return False
    kernel32.FlushFileBuffers(handle)
    return True


def serve(latest_line: Callable[[], str | None], stop: threading.Event) -> None:
    """Accept one panel at a time and send the latest snapshot line."""

    if not sys.platform.startswith("win"):
        while not stop.wait(0.5):
            pass
        return

    while not stop.is_set():
        try:
            handle = _create_pipe()
        except OSError:
            stop.wait(0.5)
            continue
        if not _connect(handle):
            kernel32.CloseHandle(handle)
            continue
        sent: str | None = None
        while not stop.is_set():
            line = latest_line()
            if line is not None and line != sent:
                if not _write_line(handle, line):
                    break
                sent = line
            if stop.wait(0.2):
                break
        kernel32.CloseHandle(handle)
