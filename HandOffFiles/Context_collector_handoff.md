# WHACK --- Project Handoff

> **Purpose:** This document is a handoff for continuing development of
> the WHACK context-aware AI desktop dashboard in a new ChatGPT
> conversation. It records the project goals, current architecture,
> imports and module relationships, context collector implementation,
> debugging history, database plan, and future roadmap.

------------------------------------------------------------------------

## 1. Project overview

WHACK is an AI-powered, context-aware desktop dashboard. It observes
activity on the computer and uses that context to recommend relevant
information, applications, shortcuts, and actions.

Examples:

-   While coding, suggest relevant documentation, commands, files, or
    tools.
-   While browsing, identify the topic of a page and surface useful
    information.
-   When clipboard content changes, understand the copied text and
    suggest useful next steps.
-   When the active application or window changes, adapt the dashboard
    to the user's current activity.
-   Eventually, let the agent perform actions through tools, with
    approval for consequential actions.

The goal is a dashboard that changes dynamically based on what the user
is doing, rather than a static dashboard.

## 2. Development environment and constraints

-   Project directory: `/home/alex/Documents/Projects/WHACK`
-   Current development environment: Linux with X11.
-   Target platforms: Linux and Windows 11.
-   User has limited Rust experience.
-   Initial build time budget: approximately 20 hours.
-   Prefer Python for collectors, context processing, persistence, and
    agent integration.
-   React and TypeScript are planned for the dashboard frontend.
-   Tauri/Rust may be considered later for desktop packaging or native
    integrations.
-   Keep the implementation incremental and practical. Avoid
    overengineering.

## 3. Planned technology stack

  Technology           Role
  -------------------- -------------------------------------------------
  Python               Context collectors, backend, context processing
  FastAPI              Backend API
  SQLite (`sqlite3`)   Local context history and memory
  React + TypeScript   Dashboard frontend
  AG-UI                Agent/backend/frontend communication
  A2UI                 Declarative dynamic UI descriptions
  `psutil`             Running process information
  `pyperclip`          Clipboard monitoring
  `xdotool`            Linux X11 active-window detection
  Tauri/Rust           Optional future desktop packaging

Documentation: - AG-UI: https://docs.ag-ui.com/ - A2UI:
https://a2ui.org/

AG-UI and A2UI have separate roles: AG-UI handles agent communication
and events; A2UI describes UI components and layouts. They can be
integrated, but the application must deliberately implement the A2UI
message handling and trusted renderer.

------------------------------------------------------------------------

## 4. Current and planned project structure

The project currently has the following context-related structure:

``` text
WHACK/
├── context/
│   ├── __init__.py
│   ├── core/
│   │   ├── __init__.py
│   │   ├── events.py
│   │   ├── models.py
│   │   └── manager.py
│   ├── collectors/
│   │   ├── __init__.py
│   │   ├── base.py
│   │   ├── clipboard.py
│   │   ├── active_window.py
│   │   └── processes.py
│   ├── platform/
│   │   ├── __init__.py
│   │   ├── detect.py
│   │   └── linux/
│   │       ├── __init__.py
│   │       └── active_window.py
│   └── tests/
│       ├── test.py
│       └── test_scratchpad.py
```

Planned additions, to be introduced incrementally:

``` text
WHACK/
├── memory/
│   ├── __init__.py
│   ├── database.py
│   ├── event_store.py
│   ├── history.py
│   └── long_term.py
├── agent/
│   ├── __init__.py
│   ├── bridge.py
│   ├── runtime.py
│   ├── prompts.py
│   └── tools.py
├── server/
│   ├── __init__.py
│   ├── main.py
│   └── agui_endpoint.py
└── frontend/
    └── React + TypeScript dashboard
```

Do not create every planned file immediately. The next practical
milestone is SQLite persistence.

------------------------------------------------------------------------

## 5. Imports and module relationships

These are the imports used or established in the current context
collector implementation. They are important because the package imports
have already caused an import error.

### 5.1 `context/collectors/base.py`

``` python
from collections.abc import Callable
from context.core.events import ContextEvent
```

The base collector defines the `Publish` callback type and the common
collector interface.

### 5.2 `context/collectors/clipboard.py`

``` python
import threading
import pyperclip

from context.collectors.base import Collector
from context.core.events import ContextEvent
```

### 5.3 `context/collectors/active_window.py`

``` python
import threading

from context.collectors.base import Collector
from context.core.events import ContextEvent
from context.platform.linux.active_window import get_active_window
```

The last import expects a function named `get_active_window` in
`context/platform/linux/active_window.py`.

### 5.4 `context/collectors/processes.py`

``` python
import threading
import psutil

from context.collectors.base import Collector
from context.core.events import ContextEvent
```

### 5.5 `context/platform/linux/active_window.py`

``` python
import subprocess
```

This module implements the Linux/X11-specific `get_active_window()`
function.

### 5.6 `context/core/events.py`

``` python
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
```

### 5.7 `context/core/manager.py`

The manager's imports include:

``` python
from collections.abc import Callable

from context.core.events import ContextEvent
from context.core.models import ContextSnapshot
from context.platform.detect import detect_platform
from context.collectors.base import Collector
```

The manager uses `Collector` for collector registration and lifecycle
management.

### 5.8 `context/tests/test.py`

The test runner imports the manager and concrete collectors:

``` python
import threading

from context.core.manager import ContextManager
from context.collectors.clipboard import ClipboardCollector
from context.collectors.active_window import ActiveWindowCollector
from context.collectors.processes import ProcessCollector
```

### 5.9 Package `__init__.py` files

Keep these files empty for now:

-   `context/__init__.py`
-   `context/core/__init__.py`
-   `context/collectors/__init__.py`
-   `context/platform/__init__.py`
-   `context/platform/linux/__init__.py`

**Important:** `context/collectors/__init__.py` previously contained an
automatic import of `ActiveWindowCollector`. The traceback showed Python
loading that package initializer while `manager.py` was importing
`context.collectors.base`. This can trigger unnecessary imports and
circular-import problems. Keep package initializers empty and import
concrete classes directly from their modules.

------------------------------------------------------------------------

## 6. Context event model

File: `context/core/events.py`

The current event model is:

``` python
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class ContextEvent:
    event_type: str
    source: str
    data: dict[str, Any]
    timestamp: str = field(default_factory=utc_now)
    event_id: str = field(default_factory=lambda: str(uuid4()))

    def to_dict(self) -> dict:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "source": self.source,
            "timestamp": self.timestamp,
            "data": self.data,
        }
```

Example:

``` python
ContextEvent(
    event_type="active_window_changed",
    source="active_window",
    data={
        "window_title": "main.py - Visual Studio Code",
        "process_name": "code"
    }
)
```

Events have: - A unique ID. - An event type. - A source. - A UTC
timestamp. - A dictionary containing event-specific data.

------------------------------------------------------------------------

## 7. Base collector

File: `context/collectors/base.py`

The current desired base class:

``` python
from collections.abc import Callable
from context.core.events import ContextEvent

Publish = Callable[[ContextEvent], None]


class Collector:
    source = "base"

    def __init__(self) -> None:
        self.enabled = True
        self.publish: Publish | None = None

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled

    def emit(self, event: ContextEvent) -> None:
        if self.enabled and self.publish is not None:
            self.publish(event)

    def start(self, publish: Publish) -> None:
        raise NotImplementedError

    def stop(self) -> None:
        raise NotImplementedError
```

Key contract: - All collectors implement `start(publish)`. - The manager
passes its `publish` method into each collector. - Collectors publish
events using `self.emit(event)`. - Collectors must not start themselves
when their module is imported. - The manager owns startup and shutdown.

------------------------------------------------------------------------

## 8. Current context collectors

### 8.1 Clipboard collector

File: `context/collectors/clipboard.py`

Purpose: - Poll the clipboard every 0.5 seconds. - Detect text
changes. - Emit a `clipboard_changed` event. - Use `pyperclip`.

Current implementation:

``` python
import threading
import pyperclip

from context.collectors.base import Collector
from context.core.events import ContextEvent


class ClipboardCollector(Collector):
    source = "clipboard"

    def __init__(self):
        super().__init__()

        self.previous_content = ""
        self.stop_event = threading.Event()
        self.thread = None

    def get_clipboard(self):
        if not self.enabled:
            return

        try:
            current_content = pyperclip.paste()

            if current_content != self.previous_content:
                self.previous_content = current_content

                event = ContextEvent(
                    event_type="clipboard_changed",
                    source=self.source,
                    data={
                        "content_type": "text",
                        "text": current_content
                    }
                )

                self.emit(event)

        except Exception as e:
            print(f"Clipboard error: {e}")

    def _run(self):
        print("Clipboard thread started")

        while not self.stop_event.is_set():
            self.get_clipboard()
            self.stop_event.wait(0.5)

        print("Clipboard thread stopped")

    def start(self, publish):
        if self.thread and self.thread.is_alive():
            return

        self.publish = publish
        self.stop_event.clear()

        self.thread = threading.Thread(
            target=self._run,
            daemon=True
        )

        self.thread.start()

    def stop(self):
        self.stop_event.set()

        if self.thread and self.thread.is_alive():
            self.thread.join()

        self.thread = None
```

Privacy considerations: - Never print raw clipboard text. - Clipboard
collection should be user-controllable. - Do not retain raw clipboard
contents indefinitely by default. - Consider secret detection/redaction
before persistence or transmission. - Consider clearing
`previous_content` when disabling the collector.

Dependency:

``` bash
pip install pyperclip
```

### 8.2 Active window collector

File: `context/collectors/active_window.py`

Purpose: - Detect changes to the active window. - Detect window-title
changes, which can often reveal browser tab changes. - Emit an
`active_window_changed` event.

Current implementation:

``` python
import threading

from context.collectors.base import Collector
from context.core.events import ContextEvent
from context.platform.linux.active_window import get_active_window


class ActiveWindowCollector(Collector):
    source = "active_window"

    def __init__(self, poll_interval=0.5):
        super().__init__()

        self.poll_interval = poll_interval
        self.previous_window = None
        self.stop_event = threading.Event()
        self.thread = None

    def check_active_window(self):
        if not self.enabled:
            return

        try:
            current_window = get_active_window()

            if current_window is None:
                return

            current_context = (
                current_window.get("window_id"),
                current_window.get("window_title"),
                current_window.get("process_id"),
                current_window.get("process_name"),
            )

            if current_context != self.previous_window:
                self.previous_window = current_context

                event = ContextEvent(
                    event_type="active_window_changed",
                    source=self.source,
                    data=current_window
                )

                self.emit(event)

        except Exception as e:
            print(f"Active window error: {e}")

    def _run(self):
        print("Active window collector started")

        while not self.stop_event.is_set():
            self.check_active_window()
            self.stop_event.wait(self.poll_interval)

        print("Active window collector stopped")

    def start(self, publish):
        if self.thread and self.thread.is_alive():
            return

        self.publish = publish
        self.stop_event.clear()

        self.thread = threading.Thread(
            target=self._run,
            daemon=True
        )

        self.thread.start()

    def stop(self):
        self.stop_event.set()

        if self.thread and self.thread.is_alive():
            self.thread.join()

        self.thread = None
```

### 8.3 Linux active-window implementation

File: `context/platform/linux/active_window.py`

The collector imports `get_active_window` from this module.

Current expected implementation:

``` python
import subprocess


def get_active_window():
    try:
        window_id = subprocess.check_output(
            ["xdotool", "getactivewindow"],
            text=True,
            stderr=subprocess.DEVNULL
        ).strip()

        title = subprocess.check_output(
            ["xdotool", "getwindowname", window_id],
            text=True,
            stderr=subprocess.DEVNULL
        ).strip()

        try:
            pid = subprocess.check_output(
                ["xdotool", "getwindowpid", window_id],
                text=True,
                stderr=subprocess.DEVNULL
            ).strip()
        except subprocess.CalledProcessError:
            pid = None

        process_name = None

        if pid:
            try:
                with open(f"/proc/{pid}/comm") as file:
                    process_name = file.read().strip()
            except (FileNotFoundError, PermissionError):
                pass

        return {
            "window_id": window_id,
            "window_title": title,
            "process_id": int(pid) if pid else None,
            "process_name": process_name
        }

    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
```

Linux dependency:

``` bash
sudo apt install xdotool
```

The user previously confirmed that standalone Python/xdotool detection
worked.

Limitations: - This implementation is Linux/X11-specific. - It does not
directly retrieve browser URLs. - A browser extension could later
provide URLs, tab IDs, and page metadata. - Windows needs a separate
platform implementation, while preserving the same `get_active_window()`
interface.

### 8.4 Process collector

File: `context/collectors/processes.py`

Purpose: - Collect running processes. - Detect changes in the process
list. - Emit a `processes_changed` event.

Dependency:

``` bash
pip install psutil
```

Current implementation:

``` python
import threading
import psutil

from context.collectors.base import Collector
from context.core.events import ContextEvent


class ProcessCollector(Collector):
    source = "processes"

    def __init__(self, poll_interval=2.0):
        super().__init__()

        self.poll_interval = poll_interval
        self.previous_processes = None
        self.stop_event = threading.Event()
        self.thread = None

    def get_processes(self):
        processes = []

        for process in psutil.process_iter(
            ["pid", "name", "exe", "status", "create_time"]
        ):
            try:
                info = process.info

                processes.append({
                    "pid": info["pid"],
                    "name": info["name"],
                    "exe": info["exe"],
                    "status": info["status"],
                    "create_time": info["create_time"],
                })

            except (
                psutil.NoSuchProcess,
                psutil.AccessDenied,
                psutil.ZombieProcess
            ):
                continue

        return sorted(processes, key=lambda p: p["pid"])

    def check_processes(self):
        if not self.enabled:
            return

        try:
            current_processes = self.get_processes()

            if current_processes != self.previous_processes:
                self.previous_processes = current_processes

                event = ContextEvent(
                    event_type="processes_changed",
                    source=self.source,
                    data={
                        "processes": current_processes,
                        "count": len(current_processes)
                    }
                )

                self.emit(event)

        except Exception as e:
            print(f"Process collector error: {e}")

    def _run(self):
        print("Process collector started")

        while not self.stop_event.is_set():
            self.check_processes()
            self.stop_event.wait(self.poll_interval)

        print("Process collector stopped")

    def start(self, publish):
        if self.thread and self.thread.is_alive():
            return

        self.publish = publish
        self.stop_event.clear()

        self.thread = threading.Thread(
            target=self._run,
            daemon=True
        )

        self.thread.start()

    def stop(self):
        self.stop_event.set()

        if self.thread and self.thread.is_alive():
            self.thread.join()

        self.thread = None
```

The initial version publishes the full process list when it changes.
Later, consider emitting process additions/removals to reduce event
size. Avoid sending the full process list to the LLM on every update.

------------------------------------------------------------------------

## 9. ContextManager

File: `context/core/manager.py`

The manager is the central point through which collectors communicate.

Its responsibilities: - Register collectors. - Start and stop
collectors. - Receive events. - Update the current context snapshot. -
Notify subscribers. - Later, integrate persistence and the AgentBridge.

The manager imports:

``` python
from collections.abc import Callable

from context.core.events import ContextEvent
from context.core.models import ContextSnapshot
from context.platform.detect import detect_platform
from context.collectors.base import Collector
```

The original manager uses a `ContextSnapshot` model and subscriber
callbacks. Its event handling includes these event types:

-   `clipboard_changed`
-   `active_window_changed`
-   `scratchpad_changed`

The manager updates snapshot fields such as clipboard text/content type,
process name, window title, and note body.

The manager has or is intended to have these lifecycle methods:

``` python
register_collector(collector)
start()
stop()
```

Simplified lifecycle pattern:

``` python
def start(self):
    if self._running:
        return

    self._running = True

    for collector in self._collectors:
        collector.start(self.publish)


def stop(self):
    for collector in self._collectors:
        collector.stop()

    self._running = False
```

This is a pattern, not a replacement for inspecting the actual current
`manager.py`.

Important implementation notes: - Do not assume
`ContextSnapshot.to_dict()` exists. Inspect `context/core/models.py`
before serialising it. - The manager should stop all collectors even if
one collector's `stop()` raises an exception. - Protect shared state if
collector threads can update it concurrently. - Avoid holding locks
while invoking subscriber callbacks. - Package `__init__.py` files
should remain empty unless there is a specific reason to add imports.

------------------------------------------------------------------------

## 10. Test runner and collector lifecycle

File: `context/tests/test.py`

The manager should own collector startup. Do not start collectors
manually and then start them a second time through the manager.

Example test runner:

``` python
import threading

from context.core.manager import ContextManager
from context.collectors.clipboard import ClipboardCollector
from context.collectors.active_window import ActiveWindowCollector
from context.collectors.processes import ProcessCollector


manager = ContextManager()

manager.register_collector(ClipboardCollector())
manager.register_collector(ActiveWindowCollector())
manager.register_collector(ProcessCollector())


def on_context_event(event, snapshot):
    # Avoid printing clipboard contents in normal use.
    print(event.event_type, event.source)


manager.subscribe(on_context_event)

manager.start()

print("Context monitoring started. Press Ctrl+C to stop.")

try:
    while True:
        threading.Event().wait(1)

except KeyboardInterrupt:
    print("\nStopping context manager...")
    manager.stop()
    print("Context monitoring stopped.")
```

Run from the project root:

``` bash
python -m context.tests.test
```

Do not use `manager.worker.join()` unless a `worker` attribute is
actually implemented.

### Previous collector debugging

A previous version of `clipboard.py` contained module-level startup:

``` python
collector = ClipboardCollector()
collector.start()
```

Those lines were removed. Collectors must not start during module
import.

The manager calls:

``` python
collector.start(self.publish)
```

Therefore each collector's `start()` must accept the callback argument.

### Most recent import error

The latest reported traceback was:

``` text
ImportError: cannot import name 'get_active_window'
from 'context.platform.linux.active_window'
```

The traceback showed this import chain:

``` text
context/tests/test.py
  -> context/core/manager.py
     -> context/collectors/base.py
        -> context/collectors/__init__.py
           -> context/collectors/active_window.py
              -> context/platform/linux/active_window.py
```

The collector imports:

``` python
from context.platform.linux.active_window import get_active_window
```

The error means Python found the module file but could not import a
function with that name from it. The likely fix is to ensure
`context/platform/linux/active_window.py` defines the exact function
`get_active_window()` shown above.

Also: - Keep `context/collectors/__init__.py` empty. - Keep
`context/platform/linux/__init__.py` empty. - Import collector classes
directly from their modules in the test runner. - Check for naming
mismatches, syntax errors, or accidental circular imports if the problem
persists.

------------------------------------------------------------------------

## 11. Database and memory design

A local persistence layer is planned next.

**Important decision: WHACK should store its own desktop context
history. Do not rely on the AI model's conversation memory to remember
desktop activity.**

Model conversation memory and application-owned desktop history are
separate systems.

### 11.1 Three memory layers

**Current context** - Current active application/window. - Clipboard
state, when enabled. - Running processes. - Browser tab information,
when available. - Current activity.

This belongs primarily in the live `ContextManager` snapshot.

**Recent history** - Window changes. - Application usage. - Clipboard
events, subject to privacy settings. - Project/file activity. - Recent
tasks and agent interactions.

Store this in SQLite.

**Long-term memory** - Ongoing projects. - User preferences. -
Frequently used applications. - Recurring workflows. - Task summaries
and important decisions.

This can also initially live in SQLite.

### 11.2 Planned database files

``` text
memory/
├── __init__.py
├── database.py
├── event_store.py
├── history.py
└── long_term.py
```

Start with only: - `database.py` - `event_store.py`

Add `history.py` and `long_term.py` when the basic event store works.

### 11.3 Initial SQLite schema

Use Python's built-in `sqlite3` module. No database server is required.

Initial table:

``` sql
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    data TEXT NOT NULL
);
```

Store the event's `data` dictionary as JSON text.

Example:

``` json
{
  "event_id": "example-id",
  "event_type": "active_window_changed",
  "source": "active_window",
  "timestamp": "2026-11-07T12:00:00Z",
  "data": {
    "window_title": "main.py - Visual Studio Code",
    "process_name": "code"
  }
}
```

Initial operations to implement:

``` python
save_event(event)
get_recent_events(limit=50)
get_relevant_context(current_context)
```

The event store should use the existing `ContextEvent.to_dict()` method
or its fields to serialise events.

### 11.4 Possible future tables

  Table                 Purpose
  --------------------- ---------------------------------------------
  `events`              Structured context events
  `context_snapshots`   Periodic desktop-state snapshots
  `sessions`            Group activity into desktop sessions
  `tasks`               Track ongoing and completed tasks
  `memories`            Long-term facts, preferences, and summaries

Do not implement all tables immediately. First prove that events can be
saved, retrieved, and retained across application restarts.

### 11.5 Database integration

Desired flow:

``` text
Collector
    |
    v
ContextManager.publish(event)
    |
    +--------------------------+
    |                          |
    v                          v
Update current snapshot    Persist event to SQLite
    |                          |
    +-------------+------------+
                  |
                  v
              Subscribers
                  |
                  v
              AgentBridge
```

Implementation sequence:

1.  Create a `Database` class that opens the SQLite database and creates
    the schema.
2.  Create an `EventStore` class that saves and retrieves `ContextEvent`
    records.
3.  Integrate the event store with the manager, either as a subscriber
    or an explicit persistence dependency.
4.  Ensure persistence failures do not crash collector threads.
5.  Test saving and retrieving events.
6.  Restart the application and verify that previously saved events
    remain.

Synchronous SQLite writes may be enough initially. If event frequency
becomes high, use a queue and a dedicated database worker.

### 11.6 Agent context retrieval

Do not send the full database history to the LLM.

Prepare a compact payload containing: - Current context. - A limited
number of recent events. - Relevant task summaries. - Relevant long-term
memories.

Example:

``` python
{
    "current_context": {
        "process_name": "code",
        "window_title": "main.py - Visual Studio Code"
    },
    "recent_events": [
        {
            "event_type": "active_window_changed",
            "source": "active_window",
            "timestamp": "...",
            "data": {}
        }
    ],
    "relevant_memories": [
        "The user is working on the WHACK desktop dashboard."
    ]
}
```

Start with simple SQL queries and filters. Add keyword search or
embeddings later, only when basic retrieval is insufficient.

### 11.7 Privacy and retention

Desktop context can contain sensitive information.

Requirements: - Make clipboard and screen collection controllable. -
Provide a pause/disable option. - Avoid indefinite retention of raw
clipboard or screenshot data. - Consider redacting passwords, access
tokens, and other secrets. - Provide a way to clear stored history. -
Keep data local by default where practical. - Send context to external
models only when necessary and permitted. - Do not log raw clipboard
content.

------------------------------------------------------------------------

## 12. AgentBridge and AI agent

Collectors should not call the model directly. An `AgentBridge` will sit
between ContextManager and the agent.

Planned files:

``` text
agent/
├── __init__.py
├── bridge.py
├── runtime.py
├── prompts.py
└── tools.py
```

### 12.1 AgentBridge responsibilities

1.  Subscribe to ContextManager events.
2.  Receive the event and current snapshot.
3.  Decide whether the event is significant.
4.  Retrieve relevant history from SQLite.
5.  Prepare a compact context payload.
6.  Send that payload to the agent.

Preliminary skeleton:

``` python
from queue import Queue, Empty
from threading import Thread, Event


class AgentBridge:
    def __init__(self, agent, max_queue_size=100):
        self.agent = agent
        self.queue = Queue(maxsize=max_queue_size)
        self.stop_event = Event()
        self.thread = None

    def on_context_event(self, event, snapshot):
        if self.queue.full():
            return

        self.queue.put({
            "event": event.to_dict(),
            "snapshot": snapshot
        })

    def start(self):
        self.thread = Thread(
            target=self._run,
            daemon=True
        )
        self.thread.start()

    def _run(self):
        while not self.stop_event.is_set():
            try:
                item = self.queue.get(timeout=1)

                if self.should_trigger_agent(item):
                    self.agent.process_context(item)

            except Empty:
                continue

    def should_trigger_agent(self, item):
        event_type = item["event"]["event_type"]

        return event_type in {
            "active_window_changed",
            "clipboard_changed"
        }

    def stop(self):
        self.stop_event.set()

        if self.thread:
            self.thread.join(timeout=3)
```

This is a conceptual starting point, not production-ready code. Before
relying on it: - Serialise snapshots rather than queueing mutable
snapshot objects. - Inspect `ContextSnapshot` before writing a
serialiser. - Handle queue overflow and backpressure. - Debounce
frequent events. - Avoid duplicate model requests. - Filter sensitive
data. - Retrieve relevant history from SQLite. - Do not trigger model
reasoning for every process-list update.

Start with a simple Python agent function. A framework such as LangGraph
can be evaluated later if needed.

------------------------------------------------------------------------

## 13. AG-UI, A2UI, and frontend

### AG-UI

AG-UI is the agent/frontend communication layer. It is intended to
handle: - Agent run lifecycle. - Streaming messages. - Tool calls and
results. - State updates. - User input and approvals.

It does not replace collectors, ContextManager, or SQLite.

### A2UI

A2UI is the declarative UI-description layer. The agent may request UI
components such as: - Relevant application cards. - Documentation
cards. - Code snippets. - Task checklists. - Search results. - Suggested
actions.

The React frontend should render these using a trusted component
catalogue. Do not execute arbitrary HTML or JavaScript generated by the
model.

### Frontend plan

Build a basic React/TypeScript dashboard after the backend context and
persistence pipeline is reliable.

The dashboard may contain: - Current activity/context. - Recommended
applications. - Relevant information. - Suggested actions. - Current
tasks. - Recent history.

------------------------------------------------------------------------

## 14. Agent tools and action safety

Potential tools:

  Tool                 Purpose
  -------------------- ----------------------------------
  `search_web`         Find relevant online information
  `search_files`       Search local project files
  `open_application`   Launch an application
  `open_url`           Open a URL
  `create_note`        Save a note
  `suggest_action`     Present a contextual action

Separate recommendations from execution: - The agent may recommend
opening a file. - Ask for approval before modifying or deleting files. -
Require explicit confirmation before sending messages, publishing
content, or taking other consequential actions. - Validate tool
arguments and permissions in the backend.

------------------------------------------------------------------------

## 15. Cross-platform plan

Keep platform-specific operations behind platform modules.

Current Linux implementation: - X11 active-window detection using
`xdotool`. - Process detection using `psutil`. - Clipboard detection
using `pyperclip`.

Future Windows implementation: - Implement a Windows active-window
provider using Windows APIs. - Keep the collector's
`get_active_window()` data contract consistent. - Check clipboard
library compatibility on Windows. - Keep process collection
platform-neutral through `psutil`.

The goal is to avoid writing separate collectors for each operating
system when only the underlying platform provider needs to change.

------------------------------------------------------------------------

## 16. Recommended next steps

Work in this order:

1.  **Resolve and verify the current import issue.** Confirm that
    `context/platform/linux/active_window.py` defines
    `get_active_window()` and that package `__init__.py` files are
    empty.
2.  **Run the collector test.** Confirm startup, event publishing, and
    clean shutdown.
3.  **Inspect `context/core/models.py` and the actual `manager.py`.**
    Confirm the exact snapshot fields and manager implementation before
    integrating persistence.
4.  **Implement SQLite.** Create `memory/database.py` and
    `memory/event_store.py`.
5.  **Test persistence.** Save events, retrieve recent events, restart,
    and retrieve them again.
6.  **Connect persistence to ContextManager.** Ensure database errors do
    not break collection.
7.  **Build AgentBridge.** Add event filtering, queueing, and context
    retrieval.
8.  **Create a basic agent runtime.** Initially receive context and
    return a simple recommendation.
9.  **Add FastAPI and AG-UI.**
10. **Build the React dashboard and A2UI renderer.**
11. **Add more context sources** such as screenshots, OCR, browser
    extension data, and file activity.
12. **Add Windows support and consider Tauri packaging.**

------------------------------------------------------------------------

## 17. Instructions for the next development conversation

Continue from this project state; do not redesign the whole system
without a clear reason.

-   Treat the collector and event code in this handoff as the current
    intended implementation, but ask for the actual file if exact
    current contents matter.
-   Do not assume methods or fields exist on `ContextSnapshot`; inspect
    `context/core/models.py`.
-   Give exact file paths and complete code when asking for a file
    replacement.
-   Explain what each change does, but keep explanations practical and
    concise.
-   Make one small change at a time and test it before moving on.
-   Prioritise resolving the current collector import issue, then SQLite
    persistence, then AgentBridge.
-   Keep the approximately 20-hour initial build constraint in mind.
-   Do not jump into Tauri or complex agent frameworks prematurely.
-   Read terminal output carefully, especially around Ctrl+C: in
    previous debugging, the user clarified that some output appeared
    only after they interrupted the program.
-   Do not print clipboard contents in logs or examples intended for
    normal use.

**Immediate next task:** verify the current `get_active_window` import
and collector startup, then implement the first SQLite event store.
