# Fix handoff

**Repo:** `C:\LocalWork\WHACK 2026\WHACK`
**Remote:** `https://github.com/qDawn/WHACK.git`
**Demo machine:** Windows 11. The user is `nggro`.
**Date:** 7 November 2026

Read this file and fix the bugs below. Do not redesign Aura. Do not commit unless the user asks. Do not leave `python -m bridge.watch` or `npm run tauri dev` running in an agent terminal; those terminals are read-only for the user.

`dashboard_handoff.md` and `context_collector_handoff.md` are stale. The pipe exists, cards open apps, and FastAPI is still not allowed. Ignore those two files as status.

## What Aura is

Aura is a Windows dashboard, not an operating system. The user starts two processes:

```text
cd "C:\LocalWork\WHACK 2026\WHACK"
python -m bridge.watch
```

```text
cd "C:\LocalWork\WHACK 2026\WHACK\hud"
npm run tauri dev
```

Python is the brain. The Tauri window is the dashboard. They talk over two Windows named pipes, one JSON object per line:

- `\\.\pipe\aura` — Python writes, the HUD reads. Payload is an AG-UI `STATE_SNAPSHOT`, plus control lines `{"protocol":"aura","type":"hud.hide"}` and `hud.error`.
- `\\.\pipe\aura-actions` — the HUD writes `{"kind":"<catalog id>"}`, Python launches that catalog entry.

The window is borderless, covers the work area, stays on top, skips the taskbar, and starts hidden. **Ctrl+Alt+Space** toggles it. A successful Open hides it. A failed Open stays up and shows the error.

`catalog.json` is the allowlist. Rules and the HUD may only choose catalog ids. Launch methods are `file`, `command`, and `link` in `bridge/launch.py`. A new app is a new catalog entry, not a new function. Paths live in `aura.config.json` and are substituted as `${godotProject}`, `${gitRepo}`, and `${scratchpadPath}`.

Current catalog ids: `open_godot`, `open_terminal`, `focus_discord`.

Rules in `rules/default.json` are AND clauses, first match wins. Keys: `noteContains`, `clipboardContains`, `processIs`, `titleContains`. A rule kind must be a catalog id.

## What already works

Keep this behavior:

- `ScratchpadCollector` polls `C:\Users\nggro\aura-scratch.md` and publishes `scratchpad_changed` with `path` and `text`. It does not write the file.
- `ContextEvent` fields are `event_type`, `source`, `data`, `timestamp`, `event_id`. There is no `platform` field. Do not pass `platform=` into it. `ContextSnapshot` still has `platform`.
- `bridge/watch.py` loads the catalog, matches rules on scratchpad changes, and serves both pipes.
- Open for Terminal works. Open for Discord starts Discord via `discord:`. The GPU cache and “secondary instance” lines after `Opened focus_discord` are printed by Discord, not by Aura.
- `Open failed: C:\Users\nggro\games\platformer\project.godot` means that placeholder file is not on disk. Put a real `project.godot` path in `aura.config.json`. That is configuration, not a launcher bug.
- Tests that were last known good: `python -m unittest context.tests.test_actions context.tests.test_rules context.tests.test_manager context.tests.test_scratchpad` from the `WHACK` directory. `pyperclip` is required because importing `context.collectors` imports the clipboard module.

Rust is `rustc` 1.99.1. The agent shell often lacks it. Prepend `%USERPROFILE%\.cargo\bin` to `PATH` before `cargo`. `link.exe` comes from Visual Studio 2022 Build Tools.

## Fix these first: the HUD does not compile

A merge pasted a second UI into the working dashboard and pasted a second Tauri builder into the middle of `run()`.

### `hud/src/App.tsx`

The file is invalid TypeScript:

- `sampleTabs` is never closed. A second `import "./App.css"` sits inside the array.
- `App` has two `return` blocks. `openAction` is stranded inside the first return.
- Line 159 uses `suggestion`, which is never declared.
- `Suggestion` is imported and then declared again.
- The first half is a mock: six fake tabs (VS Code, Browser, Spotify, Notion) and a quick note that opens paths itself with `@tauri-apps/plugin-opener`.
- The second half is the real catalog dashboard: three cards, Suggested state, `invoke("open_action", { kind })`.

Restore one component: the catalog dashboard. Cards come from the snapshot `actions` list, falling back to `DEFAULT_ACTIONS`. Suggested state comes from `suggestion.kind`. Open goes only through `open_action`. Do not open apps, files, or URLs from React.

The quick-note editor can stay only if it is added back as a small extra on that dashboard, using the existing `read_scratchpad` / `write_scratchpad` commands. It must not invent suggestions. Python rules do that. The fake tab strip is sample data and should go.

### `hud/src-tauri/src/lib.rs`

`run()` starts a builder, then a second `.invoke_handler` and `.setup` appear inside the first setup closure. That will not compile.

`toggle_window` calls `place_over_work_area`, and that function no longer exists. `fit_full_screen` replaced it.

Keep one builder:

- Commands: `read_suggestion`, `open_action`, and the scratchpad read/write commands if the editor stays.
- Setup: size the window once, spawn `listen_for_snapshots`, register Ctrl+Alt+Space.
- `open_action` stays the pipe writer. It already accepts any id matching `[A-Za-z0-9_-]+` and lets Python reject unknown ids.
- Pipe reader behavior stays: `hud.hide` hides, `hud.error` emits `hud-error`, anything else emits `snapshot` with the payload.

`App.css` contains both the mock `.hud` styles and the real `.dashboard` / `.card` styles. After the component is one dashboard again, leave the unused mock CSS or delete it. Do not restyle the product.

## Context collector bugs

These files came from the other workstream. The watcher does not start them, so clipboard and foreground-window rules cannot fire.

### Clipboard: `context/collectors/clipboard.py`

- `start(self)` does not match `Collector.start(self, publish)`. `ContextManager.start()` calls `collector.start(self.publish)`, which raises `TypeError`.
- `emit()` publishes only when `self.publish` is set. `start` never assigns it, so events would be dropped even after the signature is fixed. Store the callback, then start the thread.
- The class never sets `source = "clipboard"`. The base value is `"base"`. `ContextManager.set_clipboard_enabled` looks for `source == "clipboard"` and will not find this collector.
- `print(event)` prints clipboard text. Remove that. Do not log clipboard text or note body.
- `content_type` is always `"text"`, including an empty clipboard. Use `text`, `empty`, `non_text`, or `unavailable`. `text` is `""` unless the type is `text`.
- The thread is non-daemon. Make it a daemon thread so a missed `stop` cannot hang the process.
- Nothing at import time may start a thread or call `join`. That already blocked `bridge.watch` once.

### Foreground window

Still stubs that raise `NotImplementedError`:

- `context/collectors/active_window.py`
- `context/platform/windows/active_window.py`
- `context/platform/linux/active_window.py`

Implement Windows `foreground_window() -> tuple[str, str]` as `(process_name, window_title)`. The collector polls it and publishes `active_window_changed` only when one of those values changes. Data keys are `process_name` and `window_title`. Linux can return a harmless stub so import and tests work. Screen and process collectors are optional and are not on the demo path.

### Manager: `context/core/manager.py`

- `agent_context()` calls `self.snapshot_value.to_dict()`. `ContextSnapshot` has no `to_dict`, so this raises `AttributeError`. Add a small `to_dict` or stop calling it.
- `snapshot()` returns the live object. Callers can change it under other threads. Return a copy.
- `HUD_EVENT_TYPES` is unused.

### Wire the working collectors into `bridge/watch.py`

`on_event` returns immediately unless the event is `scratchpad_changed`. A clipboard or window event updates the manager and then never reaches the HUD.

After clipboard and the active-window collector actually work:

- Start them with the manager, or call `start(manager.publish)` the same way the scratchpad collector is started.
- On `scratchpad_changed`, `clipboard_changed`, and `active_window_changed`, run `first_match` and push a new snapshot.
- Do not register `ScratchpadCollector` through `ContextManager.register_collector` unless it subclasses `Collector`. Its current `start(publish)` / `stop()` path is the one that works.
- Keep `context/core/__init__.py` free of imports. Importing `context.core.events` runs that package init, and `ContextManager` imports `context.collectors.base`. Importing the manager from the package init causes a circular import.

## URL suggestion is unfinished

`bridge/rules.py` returns kind `open_url` when the note contains a URL, before the normal rules. `context/tests/test_rules.py` expects that. `catalog.json` has no `open_url` entry, so the dashboard has no card for it and `parse_action` would reject it.

Do not add a second launcher in React. If the URL suggestion stays, give it one catalog-shaped launch path through `bridge/launch.py`: method `link`, target equal to the URL from the note. A static catalog target cannot hold a different URL every time, so this one action needs the matched URL passed into `perform`. Keep every other action on the static catalog.

## Privacy and scope

- Record that the clipboard was used. Do not write clipboard text or the note body into logs.
- Collectors must not import `bridge`, `hud`, A2UI, or AG-UI.
- Do not add FastAPI, gRPC, or HTTP between Python and the window.
- Do not build the model-on-miss path, history-based card picker, or login autostart in this pass.
- The model block in `aura.config.json` is intentionally empty. The demo must run with it empty.

## Done when

1. `npm run tauri dev` compiles and shows the catalog dashboard, not the fake tab strip.
2. With `python -m bridge.watch` running, Open on Terminal and Discord still works, and a missing Godot path shows an error without hiding the dashboard.
3. Editing the scratchpad still changes the Suggested card.
4. Copying the git repo path suggests Terminal, and focusing another window can satisfy `processIs` / `titleContains`.
5. The clipboard collector does not print clipboard text, and its `start(publish)` works when the manager starts it.
6. The unittest command above passes.
