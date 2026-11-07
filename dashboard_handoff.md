# Dashboard handoff for the context-collector agent

**Read this instead of inventing a second integration plan.**
**Repo:** `C:\LocalWork\WHACK 2026\WHACK`
**Demo machine:** Windows 11. Linux adapters exist so you can develop on Linux.
**Last updated:** 7 November 2026

## What the dashboard side already is

The product is Aura. A small always-on-top panel suggests one next action. It does not launch apps.

The panel is a Tauri window in `hud/`. It is already running as a dev app. It starts hidden. **Ctrl+Alt+Space** shows and hides it. Today it reads `fixtures/suggestion.json` and displays the suggestion title, the target path, and the reason. Do not rebuild this window. Do not edit `hud/` unless a dashboard change is explicitly requested.

Python is the brain. Tauri is only the window. They will talk later over the Windows named pipe `\\.\pipe\aura`. That pipe is not built yet. Do not add FastAPI, WebSockets, or a Tauri command for context.

## The boundary you own

You own desktop collection. You do not own suggestions, the model, the pipe, or the panel.

```text
collectors  ->  ContextManager.publish(event)  ->  ContextSnapshot
                                                      |
                                                      v
                                            bridge/state_snapshot.py
                                                      |
                                                      v
                                            HUD STATE_SNAPSHOT
```

Collectors must not import `bridge`, A2UI, AG-UI, or anything in `hud/`. The bridge is the only translator. `context/core/processor.py` must not call a model.

## Agreed answers to the open questions

-   Same Python process. Collectors are classes, not a separate service.
-   Transport between you and the dashboard is `ContextManager`, in memory.
-   The named pipe is Windows-only and belongs to the dashboard. Ignore it.
-   `pyperclip` is the clipboard library. It is listed in `requirements.txt`.
-   Event JSON shape is already coded in `context/core/events.py`. Use it.
-   The HUD snapshot shape is already coded in `bridge/state_snapshot.py`. Match `fixtures/suggestion.json`. Do not put a suggestion in a collector event. Suggestions are added later by the dashboard.

## Package map

```text
context/
  core/            shared contract. Treat as stable.
  collectors/      you implement start/stop, except scratchpad.py
  platform/windows you implement foreground_window()
  platform/linux   you implement foreground_window() so Linux dev works
  tests/           add collector tests here
bridge/            dashboard-owned translator. Do not change the payload keys.
hud/               dashboard-owned window. Do not change it.
fixtures/suggestion.json
aura.config.json
rules/default.json
```

`aura.config.json` holds `scratchpadPath`, `godotProject`, `gitRepo`, `hotkey`, and `clipboardEnabled`. Read it. Do not invent a second config file.

## Event types

Build events with `ContextEvent` and publish them through `ContextManager.publish`.

Required for the demo:

| event_type | source | data | who writes it |
| --- | --- | --- | --- |
| `clipboard_changed` | `clipboard` | `content_type`, `text` | you |
| `active_window_changed` | `active_window` | `process_name`, `window_title` | you |
| `scratchpad_changed` | `scratchpad` | `path`, `text` | dashboard, later |

`content_type` is one of `text`, `empty`, `non_text`, `unavailable`. `text` is `""` unless `content_type` is `text`.

Optional, and safe to add later. The snapshot ignores them:

| event_type | data |
| --- | --- |
| `screen_captured` | `path`, `width`, `height` |
| `processes_updated` | `processes`: list of `{name, pid}` |

Screenshot bytes stay on disk. The event carries a path.

Example:

```json
{
  "event_type": "clipboard_changed",
  "timestamp": "2026-11-07T14:00:00Z",
  "source": "clipboard",
  "platform": "windows",
  "data": { "content_type": "text", "text": "C:\\Users\\nggro\\code\\platformer" }
}
```

`platform` is `"windows"` or `"linux"` from `context.platform.detect.detect_platform`.

## What to implement now

1. `ClipboardCollector.start` and `stop` in `context/collectors/clipboard.py`.
   - Use `pyperclip.paste()`.
   - Poll about twice a second, on a thread you own.
   - Publish only when the text changes.
   - While `self.enabled` is false, do not call `paste()`.
   - Empty clipboard publishes `content_type: "empty"`.
   - Non-text clipboard publishes `content_type: "non_text"` and `text: ""`.
   - Errors publish `content_type: "unavailable"` and do not kill the process.
   - Do not print clipboard text.
2. `foreground_window()` in `context/platform/windows/active_window.py` and `context/platform/linux/active_window.py`. Return `(process_name, window_title)`.
3. `ActiveWindowCollector.start` and `stop`. Publish `active_window_changed` only when the pair changes.
4. Tests in `context/tests/` for unchanged text, changed text, empty clipboard, and a clipboard error. Fake `pyperclip` in the test. Do not require a real desktop.

Leave these files alone:

- `context/collectors/scratchpad.py`
- `bridge/`
- `hud/`
- `fixtures/suggestion.json`
- `rules/default.json`

Screen and process collectors stay optional. The demo works without them.

## How the dashboard will use your snapshot

`ContextManager.snapshot()` returns the latest values. `bridge.state_snapshot.to_state_snapshot` turns them into:

```json
{
  "protocol": "ag-ui",
  "version": "1.0",
  "type": "STATE_SNAPSHOT",
  "runId": "live",
  "payload": {
    "process": "Notepad.exe",
    "title": "aura-scratch.md",
    "clipboardEnabled": true,
    "noteBody": "keep going on the platformer"
  }
}
```

The HUD already renders `payload.process`, `payload.title`, and a suggestion object. You do not add the suggestion. When clipboard collection is off, `clipboard_text` on the snapshot is `null` even if a collector published text.

## Privacy

- Clipboard and screen data stay on the machine.
- Do not log raw clipboard text, note text, or screenshot bytes.
- `ContextManager.set_clipboard_enabled(False)` drops clipboard text from the snapshot. Honour `Collector.enabled` as well.
- Do not upload context anywhere.

## Check your work

From `C:\LocalWork\WHACK 2026\WHACK`:

```powershell
python -m unittest context.tests.test_manager
```

That test already passes. Add your collector tests beside it and keep this one passing.

Run a collector against `ContextManager` and print only `process_name`, `window_title`, and `clipboard_content_type`. Those three fields are enough to prove the link. The panel will keep showing the fixture suggestion until the dashboard connects the pipe.
