"""Windows named pipe the Aura panel reads.

One JSON object per line. The pipe is \\.\\pipe\\aura.
"""

from collections.abc import Callable
import ctypes
from ctypes import wintypes
import sys
import threading

PIPE_NAME = r"\\.\pipe\aura"
ACTION_PIPE_NAME = r"\\.\pipe\aura-actions"
PIPE_ACCESS_OUTBOUND = 0x00000002
PIPE_ACCESS_INBOUND = 0x00000001
PIPE_TYPE_BYTE = 0x00000000
PIPE_WAIT = 0x00000000
ERROR_PIPE_CONNECTED = 535
INVALID_HANDLE = wintypes.HANDLE(-1).value

kernel32 = None
if sys.platform.startswith("win"):
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
    kernel32.ReadFile.argtypes = [
        wintypes.HANDLE,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.c_void_p,
    ]
    kernel32.ReadFile.restype = wintypes.BOOL


def _create_pipe(name: str = PIPE_NAME, access: int = PIPE_ACCESS_OUTBOUND) -> wintypes.HANDLE:
    if kernel32 is None:
        raise OSError("Windows named pipes are only available on Windows")
    handle = kernel32.CreateNamedPipeW(
        name,
        access,
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


def _read_line(handle: wintypes.HANDLE) -> str | None:
    chunks: list[bytes] = []
    buffer = ctypes.create_string_buffer(4096)
    read = wintypes.DWORD(0)
    while True:
        ok = kernel32.ReadFile(handle, buffer, 4096, ctypes.byref(read), None)
        if not ok or read.value == 0:
            break
        chunks.append(buffer.raw[: read.value])
        if b"\n" in b"".join(chunks):
            break
    if not chunks:
        return None
    return b"".join(chunks).decode("utf-8", errors="replace")


def serve(
    latest_line: Callable[[], str | None],
    stop: threading.Event,
    controls: Callable[[], list[str]] | None = None,
) -> None:
    """Accept one panel at a time and send snapshot and control lines."""

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
            pending = controls() if controls is not None else []
            failed = False
            for line in pending:
                if not _write_line(handle, line):
                    failed = True
                    break
            if failed:
                break
            line = latest_line()
            if line is not None and line != sent:
                if not _write_line(handle, line):
                    break
                sent = line
            if stop.wait(0.2):
                break
        kernel32.CloseHandle(handle)


def serve_actions(on_line: Callable[[str], None], stop: threading.Event) -> None:
    """Read one Open request at a time from the panel."""

    if not sys.platform.startswith("win"):
        while not stop.wait(0.5):
            pass
        return

    while not stop.is_set():
        try:
            handle = _create_pipe(ACTION_PIPE_NAME, PIPE_ACCESS_INBOUND)
        except OSError:
            stop.wait(0.5)
            continue
        if not _connect(handle):
            kernel32.CloseHandle(handle)
            continue
        line = _read_line(handle)
        kernel32.CloseHandle(handle)
        if line:
            on_line(line)
