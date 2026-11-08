# Focus history handoff

**Timestamp:** 2026-11-07T21:05:00Z
**Previous log:** 2026-11-07T20:53:17Z, the model reads the instruction file and the compact history.
**This is the most recent handoff.** `system_handoff.md` is still the system overview. Where this file describes the database, the model instructions, or the OpenAI key, follow this file.
**Repo:** `C:\LocalWork\WHACK 2026\WHACK`

## What changed

Foreground-app history is stored in a local SQLite file. The watcher writes it. On a rule miss the model reads `model_instructions.md` and the compact history, then names one catalog card.

The OpenAI model name and endpoint are set in `aura.config.json`. The API key is not. The key is loaded from the environment or from a gitignored file.

`catalog.json` now lists the common Windows apps. `rules/default.json` suggests one when the note names it, and suggests Godot for a `.gd` or `project.godot` window title. The original three rules stay first. `python -m memory.simulate` writes a platformer day to the `historyPath` in `aura.config.json`. Remove `historyPath` to go back to the live history file.

## How a foreground app becomes a row

```text
active window collector
    -> ContextManager.publish(active_window_changed)
    -> bridge/watch.py remember_window()
    -> memory/focus_store.py
    -> %LOCALAPPDATA%\aura\history.sqlite
```

`remember_window` runs for `active_window_changed` only. Clipboard events, scratchpad events, and the full process list are not written. A database error is printed as `History write failed` and collection continues. On Ctrl+C the open visit is closed, then the file is closed.

The process collector in `context/collectors/processes.py` is still unwired. `psutil` is still not installed. History comes from the foreground window the active-window collector already reports.

`historyPath` in `aura.config.json` overrides the file location. With that key absent, the file is:

```text
C:\Users\nggro\AppData\Local\aura\history.sqlite
```

## What is stored

Table `focus_sessions`, created by `memory/database.py`:

| column | meaning |
| --- | --- |
| `id` | random id |
| `process_name` | file name only, such as `Code.exe` |
| `window_title` | title while that app was in front |
| `started_at` | UTC time it came to the front |
| `ended_at` | UTC time the user left it; empty while it is still in front |
| `duration_ms` | length of that visit |

`memory/focus_store.py` decides which windows count.

- The same app staying in front updates the open row's title. A new row starts only when a different app comes to the front.
- A visit shorter than 2 seconds is deleted. An Alt-Tab glance is not a session.
- Shell and host processes are ignored: Search, the Start menu, Game Bar, `ApplicationFrameHost`, `TextInputHost`, `RuntimeBroker`, `conhost`, `dwm`, and the rest of the list in `focus_store.py`.
- A process named `aura`, or a window titled exactly `Aura`, is ignored. Opening the dashboard does not become a work session. During `npm run tauri dev` the process is `hud.exe` and the title is `Aura`, so the title check covers that.
- The empty desktop (`explorer.exe` with title `Program Manager`) ends the current visit and is not stored. An open folder window is stored.
- An empty process name or an empty title is ignored.
- A full executable path is reduced to the file name before it is stored. Process ids are not stored.
- Clipboard text and the note body are not stored.
- A session left open by a crash is closed on the next start with `duration_ms` 0. That row is kept in the file and left out of the model payload, so a crash does not look like a long visit.

## What the model reads

On a rule miss, `bridge/watch.py` calls `read_process_history()` and passes the result to `suggest()`. `model_instructions.md` is the system message. The user message is the current window, note, clipboard, and this payload. The SQLite file is not sent.

`FocusStore.get_process_history()` returns:

- `recent`: the open visit, with `duration_ms` null, plus the last 12 finished visits.
- `frequent`: the 5 process names with the most foreground time over the previous 24 hours. Each item has `focus_count`, `total_ms`, and `last_seen`.

Card ids stay in `catalog.json`. This table stores process names.

## Files

| path | role |
| --- | --- |
| `memory/__init__.py` | Package marker. Importing it does no work. |
| `memory/database.py` | Opens SQLite and creates `focus_sessions`. |
| `memory/focus_store.py` | Filter, sessions, and `get_process_history()`. |
| `memory/tests/test_focus_store.py` | Filter, duration, restart, and the watcher hook. |
| `bridge/watch.py` | Opens the store, records foreground changes, closes the visit on shutdown, and gives the compact history to the model. |
| `model_instructions.md` | The brief the model receives as its system message. |

Check, from the `WHACK` directory:

```text
python -m unittest context.tests.test_model context.tests.test_rules context.tests.test_actions context.tests.test_manager context.tests.test_scratchpad memory.tests.test_focus_store
```

The last line should be `OK`.

## OpenAI key

`aura.config.json` has `baseUrl` `https://api.openai.com/v1` and `name` `gpt-4o-mini`. `apiKey` in that file stays `""`. That file is tracked by git.

`bridge/model.py` resolves the key in this order:

1. Environment variable `AURA_OPENAI_API_KEY`
2. A non-empty `model.apiKey` in the config passed to the watcher
3. `aura.secrets.json` in the `WHACK` directory

`aura.secrets.json` is listed in `.gitignore`. `*.sqlite` is also ignored. There is no example secrets file.

If the endpoint is `api.openai.com` and no key is found, the watcher does not call the network. It prints:

```text
Model is off. Add the key to aura.secrets.json or AURA_OPENAI_API_KEY.
```

After a key is present, restart `python -m bridge.watch`. The line becomes `Model is on. It runs only when no rule matches.` Rules still win. The model runs only when every rule misses. That request includes `model_instructions.md` and the compact focus history.

Do not print the key. Do not commit `aura.secrets.json`. A ChatGPT subscription is not an API key. If a key is ever pushed, revoke it at https://platform.openai.com/api-keys and create a new one.
