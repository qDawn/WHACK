# Aura system handoff

**Read this file first.** It describes the system as of 7 November 2026 20:38.
**Most recent log:** `ui_handoff.md` at **2026-11-07T22:27:33Z**. Give that file to the UI overhaul. `history_handoff.md` at 2026-11-07T21:05:00Z still covers the focus database, the catalog, and the OpenAI key.
**Repo:** `C:\LocalWork\WHACK 2026\WHACK`
**Remote:** `https://github.com/qDawn/WHACK.git`
**Demo machine:** Windows 11. The user is `nggro`.
**Product name:** Aura. The repo folder is WHACK. Aura is a dashboard, not an operating system.

`dashboard_handoff.md` and `fix_handoff.md` are older and partly wrong. `Context_collector_handoff.md` is the teammate's plan. Where it disagrees with this file, follow this file. Do not add FastAPI. Do not commit unless the user asks. Do not leave `python -m bridge.watch` or `npm run tauri dev` running in an agent terminal. Those terminals are read-only for the user.

## What the user runs

Two processes. The user starts both. Tauri does not spawn Python.

```text
cd "C:\LocalWork\WHACK 2026\WHACK"
python -m bridge.watch
```

```text
cd "C:\LocalWork\WHACK 2026\WHACK\hud"
npm run tauri dev
```

The window starts hidden. **Ctrl+Alt+Space** shows and hides it. It is borderless, covers the work area, stays above other windows, and skips the taskbar. A successful Open hides it. A failed Open stays up and shows the error.

Automated check, from the `WHACK` directory:

```text
python -m unittest context.tests.test_model context.tests.test_rules context.tests.test_actions context.tests.test_manager context.tests.test_scratchpad memory.tests.test_focus_store
```

The last line should be `OK`. `python -m context.tests.test` is the teammate's live collector loop. It needs `psutil`, prints events, and is not the dashboard test.

Rust is `rustc` 1.99.1 under `%USERPROFILE%\.cargo\bin`. The agent shell often lacks that directory, so prepend it to `PATH` before `cargo`. `link.exe` comes from Visual Studio 2022 Build Tools.

## How a suggestion reaches the screen

```text
collectors
    -> ContextManager.publish(event)
    -> ContextSnapshot
    -> bridge/watch.py
         rules first (bridge/rules.py)
         model only on a total miss (bridge/model.py)
    -> JSON line on \\.\pipe\aura
    -> hud listens and renders cards

Open click
    -> invoke("open_action")
    -> JSON line on \\.\pipe\aura-actions
    -> bridge/launch.py
```

Pipes are byte-mode Windows named pipes. One JSON object per line.

- `\\.\pipe\aura` — Python writes, the HUD reads. The payload is an AG-UI `STATE_SNAPSHOT`. Control lines are `{"protocol":"aura","type":"hud.hide"}` and `{"protocol":"aura","type":"hud.error","message":"..."}`.
- `\\.\pipe\aura-actions` — the HUD writes `{"kind":"<id>"}`. Python launches that id.

The HUD fields that matter are `payload.actions` (`kind`, `title`, `detail`), `payload.suggestion` (`kind`, `title`, `detail`, `reason`, `source`), plus `process`, `title`, `clipboardEnabled`, and `noteBody`. This is a small AG-UI-shaped subset. It is not the official AG-UI SDK, and the React view is not a generic A2UI renderer.

## What is built

### Dashboard, `hud/`

Tauri 2, React, TypeScript. Identifier `com.whack.aura`.

`hud/src/App.tsx` shows three cards. The best match is marked Suggested. The other two are the next apps from recent history. Quick note stays along the bottom. Open calls `open_action` only. Apps are not opened from React. A matching rule cancels the model, so the model makes no API call while a rule matches.

Quick note reads and writes `scratchpadPath` through the Tauri commands `read_scratchpad` and `write_scratchpad`. Saving the note lets the scratchpad collector see the edit. The note editor does not choose a card.

`hud/src-tauri/src/lib.rs` registers `read_suggestion`, `open_action`, `read_scratchpad`, and `write_scratchpad`. `open_action` accepts any id matching `[A-Za-z0-9_-]+` and lets Python reject unknown ids, so a new catalog entry does not need a HUD rebuild. `read_suggestion` still reads `fixtures/suggestion.json` and is not the live path.

### Watcher, `bridge/watch.py`

Loads `aura.config.json`, `rules/default.json`, and `catalog.json`. Subscribes to the manager. Starts the clipboard collector when `clipboardEnabled` is true, always starts the active-window collector, and starts the scratchpad collector itself. Serves both pipes.

On `clipboard_changed`, `active_window_changed`, or `scratchpad_changed`, it runs the rules and pushes a snapshot. Any other event is ignored by the HUD update.

### Rules, `bridge/rules.py`

AND clauses, first match wins. Keys: `noteContains`, `clipboardContains`, `processIs`, `titleContains`. Matching is case-insensitive. Tokens `${godotProject}`, `${gitRepo}`, and `${scratchpadPath}` are replaced from config.

Before the rule list, a URL in the note returns kind `open_url`. That id is not in `catalog.json`. The watcher adds a temporary card and, on Open, calls `perform("open_url", ..., target=url)`.

Current rules in `rules/default.json`:

- note contains `platformer` -> `open_godot`
- clipboard contains the git repo path -> `open_terminal`
- note contains `discord` -> `focus_discord`

A note that contains both `platformer` and `discord` suggests Godot, because that rule is first. A URL beats every rule. Later rules in the same file suggest a card when the note names that app, and a `.gd` or `project.godot` window title suggests Godot. The first three rules stay ahead of those.

### Catalog, `catalog.json` and `bridge/launch.py`

The catalog is the allowlist. Rules and the model may only choose these ids, plus the special `open_url` case above. Launch methods are `file`, `command`, and `link`. A new app is a new catalog entry, not a new function.

| id | method | what it does |
| --- | --- | --- |
| `open_godot` | file | `os.startfile` on `${godotProject}`. Missing files raise `FileNotFoundError`. |
| `open_terminal` | command | `wt.exe -d ${gitRepo}`, then PowerShell if Windows Terminal is missing. |
| `focus_discord` | link | `os.startfile("discord:")`. |

The rest of `catalog.json` is the common Windows set: editors, browsers, Explorer, Notepad, Office, chat, music, and the built-in Windows apps. Each one is a `link` or a `command`. `aura.config.json` sets `historyPath` to the simulated history file. Remove that key to record into `%LOCALAPPDATA%\aura\history.sqlite` again. Rebuild the simulation with `python -m memory.simulate`.

`Open failed: C:\Users\nggro\games\platformer\project.godot` means that placeholder file is not on disk. Put a real `project.godot` path in `aura.config.json`. Lines after `Opened focus_discord` about a GPU cache or a second instance are printed by Discord, not by Aura.

### Model, `bridge/model.py`

Optional. If `model.baseUrl` or `model.name` is empty, the watcher prints `Model is off. Rules only.` and never calls the network.

When both are set, a total rule miss waits about 0.6 seconds and POSTs to `{baseUrl}/chat/completions` with temperature 0 and the configured timeout. The reply is accepted only when it names exactly one catalog id. The same context is not sent twice. A later rule match cancels an in-flight reply. The chosen card says `No rule matched. The model chose this from recent app history.`

The system message is the text of `model_instructions.md`. The user message adds the current snapshot and `get_process_history()`: the open visit, the last 12 finished visits, and the top 5 apps from the last 24 hours. The database file itself is not sent.

`aura.config.json` now has `baseUrl` `https://api.openai.com/v1` and `name` `gpt-4o-mini`. `apiKey` in that file stays empty. The key is read from `AURA_OPENAI_API_KEY`, then from a non-empty `model.apiKey`, then from gitignored `aura.secrets.json`. OpenAI is left off until one of those has a key, and the watcher says to add it. A ChatGPT subscription is not an API key. Do not commit a filled-in key. Do not print the note, the clipboard, or the key. See `history_handoff.md`.

### Context collectors

`ContextEvent` fields are `event_type`, `source`, `data`, `timestamp`, and `event_id`. There is no `platform` field. Do not pass `platform=` into it. `ContextSnapshot` still has `platform`.

Package `__init__.py` files under `context/collectors/`, `context/platform/linux/`, and `context/platform/windows/` must stay empty. Import classes from their modules. Importing `context.collectors` used to pull in `psutil` and crash the watcher.

| File | Behavior | Started by the watcher |
| --- | --- | --- |
| `context/collectors/scratchpad.py` | Polls the note file about every 0.4 seconds. Publishes `scratchpad_changed` with `path` and `text`. Does not subclass `Collector`. | Yes, directly. |
| `context/collectors/clipboard.py` | Polls `pyperclip` every 0.5 seconds. Publishes `clipboard_changed`. `source` is `clipboard`. `start(publish)` stores the callback. The thread is a daemon. It does not print clipboard text. | Yes, when clipboard collection is enabled. |
| `context/collectors/active_window.py` | Polls every 0.5 seconds. Windows uses `context/platform/windows/active_window.py`. Linux uses `xdotool` in `context/platform/linux/active_window.py`. Both return `window_id`, `window_title`, `process_id`, and `process_name`. | Yes. |
| `context/collectors/processes.py` | Polls `psutil` every 2 seconds and publishes `processes_changed` with the full process list. | No. `psutil` is not installed. |
| `context/collectors/screen.py` | Stub. `start` raises `NotImplementedError`. | No. |

`context/core/manager.py` registers collectors, starts them with `publish`, updates the snapshot, and keeps the last 100 events in a memory deque. That deque is lost when the process exits. `snapshot()` returns a copy. `agent_context()` serialises the snapshot and that deque, but the watcher never calls it. Subscribers are still invoked while the manager lock is held.

The active-window snapshot uses `process_name` and `window_title`. A missing process name becomes an empty string, not the word `None`.

## Config

`aura.config.json`:

- `scratchpadPath`: `C:\Users\nggro\aura-scratch.md`
- `godotProject`: `C:\Users\nggro\games\platformer\project.godot` (placeholder, file is not there)
- `gitRepo`: `C:\Users\nggro\code\platformer`
- `hotkey`: `ctrl+alt+space`
- `clipboardEnabled`: true
- `model`: `baseUrl` `https://api.openai.com/v1`, empty `apiKey`, `name` `gpt-4o-mini`, `timeoutMs` 8000. The key belongs in `aura.secrets.json` or `AURA_OPENAI_API_KEY`.

`requirements.txt` lists `pyperclip` only.

## What is not built

Do not start these unless the user asks.

1. **SQLite history.** Built. See `history_handoff.md` at 2026-11-07T20:39:25Z. `memory/database.py` and `memory/focus_store.py` store foreground focus sessions in `%LOCALAPPDATA%\aura\history.sqlite`. This is not the generic `events` table from `Context_collector_handoff.md`. The model's conversation memory is not the history.
2. **Privacy for that database.** In place for process history. Clipboard text and the note body are not stored. Window title and process file name are stored. Do not send the whole database to the model. `get_process_history()` is the payload that goes out on a rule miss.
3. **An agent package.** The teammate's planned `agent/` package and AgentBridge do not exist. The watcher asks `bridge/model.py` on a rule miss, and that call includes the compact focus history. It does not rank every card.
4. **History-based card order.** Cards come from the catalog, plus a temporary URL card. Nothing ranks them from past activity.
5. **One-command startup.** The user still starts Python and Tauri separately.
6. **Process list and screenshots.** The process collector is unwired. The screen collector is a stub. The HUD snapshot does not include either.
7. **Login autostart, and a journal under `%APPDATA%\aura`.** Both were deferred on purpose.

## Constraints that are easy to break

- Collectors must not import `bridge`, `hud`, A2UI, or AG-UI.
- New apps go in `catalog.json`. Do not add one launch function per app.
- Do not open files, URLs, or apps from React. Open goes through the action pipe.
- A URL suggestion has to keep going through `bridge/launch.py`. Its target changes with the note, so it cannot be a static catalog row.
- `context/core/__init__.py` must not import the manager. Importing events runs that package init, and the manager imports `context.collectors.base`.
- Nothing at import time may start a thread or call `join`.
- `manager.stop()` already continues if one collector's `stop()` raises.
- Windows and Linux active-window providers must keep the same dictionary keys.
