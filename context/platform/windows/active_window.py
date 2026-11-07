"""Windows foreground window. Importing this module does not query the desktop."""

import ctypes
import threading
from ctypes import wintypes
from pathlib import Path

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_bound = False
_bind_lock = threading.Lock()


def _bind() -> tuple[ctypes.WinDLL, ctypes.WinDLL]:
    global _bound
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    with _bind_lock:
        if _bound:
            return user32, kernel32
        user32.GetForegroundWindow.restype = wintypes.HWND
        user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
        user32.GetWindowTextLengthW.restype = ctypes.c_int
        user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        user32.GetWindowTextW.restype = ctypes.c_int
        user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        user32.GetWindowThreadProcessId.restype = wintypes.DWORD

        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.QueryFullProcessImageNameW.argtypes = [
            wintypes.HANDLE,
            wintypes.DWORD,
            wintypes.LPWSTR,
            ctypes.POINTER(wintypes.DWORD),
        ]
        kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        _bound = True
    return user32, kernel32


def get_active_window() -> dict | None:
    """Return the foreground window in the same shape as the Linux provider."""

    user32, kernel32 = _bind()
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None

    length = user32.GetWindowTextLengthW(hwnd)
    title_buffer = ctypes.create_unicode_buffer(max(length, 0) + 1)
    user32.GetWindowTextW(hwnd, title_buffer, len(title_buffer))

    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    process_name = ""
    process = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if process:
        try:
            size = wintypes.DWORD(32768)
            path_buffer = ctypes.create_unicode_buffer(size.value)
            if kernel32.QueryFullProcessImageNameW(process, 0, path_buffer, ctypes.byref(size)):
                process_name = Path(path_buffer.value).name
        finally:
            kernel32.CloseHandle(process)
    return {
        "window_id": str(int(hwnd)),
        "window_title": title_buffer.value,
        "process_id": int(pid.value) if pid.value else None,
        "process_name": process_name or None,
    }


def foreground_window() -> tuple[str, str]:
    """Return (process_name, window_title) for the Windows foreground window."""

    window = get_active_window()
    if window is None:
        return "", ""
    return window.get("process_name") or "", window.get("window_title") or ""
