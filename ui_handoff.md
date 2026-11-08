# Aura UI handoff

**Timestamp:** 2026-11-07T22:27:33Z
**Give this file to the new chat.** That chat is an interface overhaul. The user will describe the visual design in more detail there.
**Repo:** `C:\LocalWork\WHACK 2026\WHACK`
**Remote:** `https://github.com/qDawn/WHACK.git`
**Demo machine:** Windows 11. The user is `nggro`.
**Product name:** Aura. The repo folder is WHACK. Aura is a dashboard, not an operating system.

`system_handoff.md` is the system overview. `history_handoff.md` (2026-11-07T21:05:00Z) covers the focus database, the catalog, and the model key. This file is the newer brief for the HUD. Do not add FastAPI. Do not commit unless the user asks. Do not leave `python -m bridge.watch` or `npm run tauri dev` running in an agent terminal.

## What the user wants next

The current screen is three solid cards and a quick note. Replace that presentation with a translucent overlay in the style of Apple's liquid-glass dashboard. The user will specify the look more precisely in the new chat.

The dashboard must be editable. The user arranges their own widgets. The first launch shows a default dashboard. After that, Aura remembers the user's widget choices and positions, and restores them on the next launch.

One new widget is already specified:

**Tab manager.** It lists the tabs of the window the user is in. The list is an overlapping dropdown. Hovering a row highlights that tab and shows a preview of it. Choosing a hovered row switches the real window to that tab.

Nothing in the repo reads browser tabs, draws tab previews, or activates a tab. The active-window collector only reports one `window_title`, `process_name`, `process_id`, and `window_id`. Building this widget means a new Windows source plus a HUD widget. Do not invent tab data in React.

## What is on screen today

Tauri 2, React, TypeScript. Identifier `com.whack.aura`. Window title `Aura`. The window starts hidden. **Ctrl+Alt+Space** shows and hides it. It is borderless, covers the work area, stays above other windows, and skips the taskbar. `hud/src-tauri/tauri.conf.json` does not set `transparent`. The page background is the solid colour `#070b12` in `hud/src/App.css`.

`hud/src/App.tsx` renders at most three cards from `payload.actions`. The card whose `kind` matches `payload.suggestion.kind` is marked Suggested and shows `suggestion.reason`. The others are marked Also. Quick note sits in `.bottom-dock` at the bottom of the screen. Opening it shows the editor above the Quick note button. The page does not scroll.

Quick note reads and writes `scratchpadPath` through the Tauri commands `read_scratchpad` and `write_scratchpad`. Saving the note lets the scratchpad collector see the edit. The note does not choose a card by itself. Rules in `rules/default.json` read the saved note.

There is no saved dashboard layout. Widget position is whatever `App.tsx` and `App.css` hard-code.

## What must keep working

The user starts the two processes. Tauri does not spawn Python.

```text
cd "C:\LocalWork\WHACK 2026\WHACK"
python -m bridge.watch
```

```text
cd "C:\LocalWork\WHACK 2026\WHACK\hud"
npm run tauri dev
```

```text
collectors
    -> ContextManager.publish(event)
    -> ContextSnapshot
    -> bridge/watch.py
         rules first
         history ranking for the three cards
         model only when every rule misses
    -> JSON line on \\.\pipe\aura
    -> hud listens and renders

Open click
    -> invoke("open_action")
    -> JSON line on \\.\pipe\aura-actions
    -> bridge/launch.py
```

Pipes are byte-mode Windows named pipes. One JSON object per line.

- `\\.\pipe\aura` — Python writes, the HUD reads. The payload is an AG-UI `STATE_SNAPSHOT`. Control lines are `{"protocol":"aura","type":"hud.hide"}` and `{"protocol":"aura","type":"hud.error","message":"..."}`.
- `\\.\pipe\aura-actions` — the HUD writes `{"kind":"<id>"}`. Python launches that id.

HUD fields that already exist: `payload.actions` (`kind`, `title`, `detail`), `payload.suggestion` (`kind`, `title`, `detail`, `reason`, `source`), plus `process`, `title`, `clipboardEnabled`, and `noteBody`. This is a small AG-UI-shaped subset. It is not the official AG-UI SDK, and the React view is not a generic A2UI renderer.

`bridge/rank.py` `top_cards()` keeps the list at three: the winning suggestion first, then the apps with the most foreground time. `bridge/watch.py` sends only that list. A URL in the note still adds a temporary `open_url` card and beats every rule.

Open still goes through `open_action` and `bridge/launch.py`. Do not open files, URLs, or apps from React. New apps are new rows in `catalog.json`, not new launch functions. `open_action` accepts any id matching `[A-Za-z0-9_-]+` and lets Python reject unknown ids, so a new catalog entry does not need a HUD rebuild.

A successful Open hides the window. A failed Open stays up and shows the error.

Collectors must not import `bridge`, `hud`, A2UI, or AG-UI. Nothing at import time may start a thread or call `join`.

## Suggestion behaviour the UI is showing

Rules in `rules/default.json` win. A match cancels the model, so OpenAI is not called.

If no rule matches, the watcher immediately suggests the top history card and prints `No rule matched`. The reason is `From your recent apps.` The model may replace that card later. Its reason is `No rule matched. The model chose this from recent app history.`

On 7 November 2026 the user cleared the note. Godot appeared as Suggested. The watcher terminal printed that the model request failed. That matches the code: Godot is the most-used app in the simulated history, so the history card is published before the model returns. `ModelAdvisor` prints `Model request failed` and leaves the history card in place. The failed request is deferred. Do not treat the Godot card as proof that the model answered.

The note file is `C:\Users\nggro\aura-scratch.md`. While it contained `firefox`, the firefox rule matched and the model was not called. A URL in the note, the word `platformer`, the word `godot`, or a window title containing `.gd` or `project.godot` also suggests Godot by rule. The clipboard path `C:\Users\nggro\code\platformer` suggests Terminal by rule.

`catalog.json` has 36 cards. The HUD must not show the whole catalog. `aura.config.json` sets `historyPath` to `C:\Users\nggro\AppData\Local\aura\simulated_history.sqlite`. That file is a platformer day: Godot has the most time, then Visual Studio Code. `python -m memory.simulate` rebuilds it. Remove `historyPath` to record into `%LOCALAPPDATA%\aura\history.sqlite` again.

The model key is in gitignored `aura.secrets.json`. `aura.config.json` keeps `apiKey` empty. Do not print or commit the key. The model name is `gpt-4o-mini`. Instructions are `model_instructions.md`.

## Checks

From the `WHACK` directory:

```text
python -m unittest context.tests.test_model context.tests.test_rules context.tests.test_actions context.tests.test_manager context.tests.test_scratchpad context.tests.test_rank memory.tests.test_focus_store
```

The last line should be `OK`.

Rust is `rustc` 1.99.1 under `%USERPROFILE%\.cargo\bin`. The agent shell often lacks that directory, so prepend it to `PATH` before `cargo`. `link.exe` comes from Visual Studio 2022 Build Tools.

After a HUD change, exercise the window the user actually sees: three cards, Quick note at the bottom, Open still going through the action pipe, and the layout still there after a restart once saving exists.
