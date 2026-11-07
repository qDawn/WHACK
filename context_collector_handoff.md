# Project Handoff: Context Collection System

**Project:** Context-aware AI dashboard\
**Workstream:** Desktop context collection\
**Status:** Early implementation / setup\
**Last updated:** 7 November 2026

## 1. Project overview

The project is an AI-powered dashboard that uses the user's current
desktop context to suggest relevant applications, shortcuts, information
and actions.

The context collection system is responsible for gathering information
from the desktop---initially the clipboard, active window and
screen---and turning it into structured context that can later be
processed by an AI agent.

The dashboard is being developed by a teammate. This workstream focuses
on the context collector and its interface with the dashboard/agent.

## 2. Current technical direction

-   **Implementation language:** Python for the initial prototype.
-   **Target operating systems:** Windows 11 (deployment target) and
    Linux (current development machine).
-   **Clipboard library:** `pyperclip`.
-   **Likely backend/API:** FastAPI, if a local service is needed to
    communicate with the dashboard.
-   **Architecture goal:** Keep platform-specific collection separate
    from shared context-processing logic.
-   **UI/agent protocols:** The wider project intends to use A2UI for
    declarative UI and AG-UI for agent/frontend communication. The
    context collector should not depend directly on either protocol.

Python was chosen over Rust for the 20-hour prototype because it enables
faster implementation. Rust can be considered later for
performance-critical or OS-specific components.

## 3. What I am building

The context collector is intended to gather:

1.  **Clipboard content** --- detect when copied text changes and make
    the latest content available to the context manager.
2.  **Active application/window** --- identify the foreground
    application and window title.
3.  **Screen content** --- capture screenshots on demand and, later,
    extract visible text with OCR.
4.  **Running applications** --- obtain basic information about
    currently running processes.

The first implementation task is the clipboard collector using
`pyperclip`.

## 4. Current progress

### Started / selected

-   Chosen Python for the initial context-collection prototype.
-   Identified `pyperclip` as the first clipboard library to try.
-   Confirmed that `pyperclip.paste()` uses the same Python code on
    Linux and Windows.
-   Identified Linux clipboard backend requirements:
    -   X11: `xclip` or `xsel`.
    -   Wayland: `wl-clipboard` may be required.
    -   Windows: normally no separate clipboard utility is required.

### Not yet confirmed or implemented

-   A working clipboard collector has not yet been demonstrated on both
    operating systems.
-   No completed active-window or screenshot collector.
-   No shared context manager or event pipeline yet.
-   No agreed API/data contract with the dashboard developer.
-   No AG-UI or A2UI integration from the collector yet.

## 5. Initial clipboard prototype

Install:

``` bash
pip install pyperclip
```

Basic read:

``` python
import pyperclip

clipboard_content = pyperclip.paste()
print(clipboard_content)
```

A simple polling proof of concept:

``` python
import time
import pyperclip

previous_content = None

while True:
    try:
        current_content = pyperclip.paste()

        if current_content != previous_content:
            previous_content = current_content
            print("Clipboard changed:", current_content)

        time.sleep(0.5)

    except Exception as exc:
        print(f"Clipboard error: {exc}")
        time.sleep(1)
```

This is only a prototype. The intended implementation should avoid
printing or transmitting clipboard contents by default, handle errors
and empty/non-text clipboard data, and expose changes through a
collector/event interface rather than owning the application's main
loop.

## 6. Proposed project structure

This is a suggested structure, not an existing completed codebase:

``` text
context/
├── core/
│   ├── models.py
│   ├── events.py
│   ├── manager.py
│   └── processor.py
├── collectors/
│   ├── base.py
│   ├── clipboard.py
│   ├── screen.py
│   ├── active_window.py
│   └── processes.py
├── platform/
│   ├── linux/
│   └── windows/
└── tests/
    ├── fixtures/
    └── test_collectors.py
```

The shared core should consume a common event format. OS-specific
details should stay inside platform adapters where possible.

## 7. Proposed context event contract

A collector should publish structured events rather than calling the AI
model directly. For example:

``` json
{
  "event_type": "clipboard_changed",
  "timestamp": "2026-11-07T14:00:00Z",
  "source": "clipboard",
  "platform": "linux",
  "data": {
    "content_type": "text",
    "text": "Example copied text"
  }
}
```

This is illustrative and needs to be agreed with the dashboard teammate.
Consider whether the event should contain the clipboard text itself or
only a local reference/summary. Avoid retaining sensitive clipboard data
unnecessarily.

## 8. Suggested interface for the dashboard teammate

The dashboard should not need to know how clipboard or screen data was
collected, or whether the collector is running on Linux or Windows.

A useful initial integration contract would be:

-   The collector runs locally on the user's machine.
-   It emits typed context events when something relevant changes.
-   The context manager maintains the latest context snapshot.
-   The dashboard/agent can request a sanitized context snapshot when
    needed.
-   The collector does not send data to an LLM itself.
-   The dashboard and collector agree on event names, JSON schemas,
    timestamps and transport (for example, local HTTP/WebSocket or
    another agreed mechanism).

**Open integration question:** Decide with the dashboard developer
whether the collector will run as a module inside the same Python
process, as a separate local service, or communicate through a Tauri
command/event bridge. Do not assume this boundary until it is agreed.

## 9. Immediate next steps

1.  Install `pyperclip` and verify reading text copied from different
    applications on Linux.
2.  Check which display server is in use (X11 or Wayland) and install
    the relevant clipboard utility if necessary.
3.  Turn the polling prototype into a small `ClipboardCollector` class
    with `start`, `stop` and change-notification behaviour.
4.  Add tests for unchanged content, changed content, empty clipboard
    and clipboard errors.
5.  Agree the event schema and communication boundary with the dashboard
    teammate.
6.  Test the same clipboard behaviour on Windows 11, ideally on the
    target laptop or a Windows VM.
7.  Add active-window and screenshot collectors after the clipboard path
    works.

## 10. Privacy and security requirements

Clipboard and screen data can contain passwords, access tokens, private
messages and personal information.

-   Make clipboard and screen collection visible and controllable by the
    user.
-   Provide pause/disable controls.
-   Do not upload raw clipboard contents or screenshots by default.
-   Filter or redact likely secrets before any external processing.
-   Keep collection local where practical.
-   Minimise retention and avoid logging raw sensitive content.
-   Ask for confirmation before actions that modify, send or publish
    information.

## 11. Scope for the initial prototype

The immediate goal is **not** to build the complete AI agent or
dashboard. It is to prove that a local Python context collector can
reliably capture a small set of desktop signals, normalise them into a
consistent event format, and make that context available to the
dashboard through an agreed interface.
