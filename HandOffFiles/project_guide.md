# Aura project guide

**Date:** 2026-11-08
**Repo:** `C:\LocalWork\WHACK 2026\WHACK`
**Product name:** Aura. The folder is WHACK. Aura is a dashboard, not an operating system.

This file is the current picture of the whole project. Older notes in this folder (`state_handoff.md`, `system_handoff.md`, `ui_handoff.md`, `fix_handoff.md`, and the others) disagree with the code on the catalog, Godot, Office, ranking, and how the demo is started. Teach from this file.

## For the chat that teaches from this file

Teach one section at a time, in the order below. After each section, ask the learner to explain it back in their own words before moving on. When the walkthrough is finished, close the file and test them from the question list at the end. Mark an answer wrong when it describes a removed app, a Chrome search card, or a path that this file says is stale. Do not implement features during that session. Do not print or ask for the model key, the note body, or the clipboard.

## What Aura is

Aura is a borderless dashboard that appears over the Windows desktop. It suggests one next app, shows the real windows already open, holds a quick note, and can pin shortcut widgets. It does not replace Windows, does not inject into games, and does not launch apps from the React code.

The machine is Windows 11. Two programs must both be running. Tauri does not start Python.

- `start-demo.bat` in the repo root opens both. One window is titled **Aura watcher** and runs `python -m bridge.watch`. The other is titled **Aura HUD** and runs `npm run tauri dev` inside `hud`, with `%USERPROFILE%\.cargo\bin` on that window’s `PATH`.
- Or start them by hand: `python -m bridge.watch` from the repo root, and `npm run tauri dev` from `hud`.

The window starts hidden. **Ctrl+Alt+Space** shows and hides it. A Rust change needs the HUD process restarted. A CSS or TypeScript change can refresh.

## The two processes

```text
Collectors (active window, clipboard, scratchpad)
  -> ContextManager
  -> bridge/watch.py
       URL in the note, else rules, else history card, else the model
  -> JSON line on \\.\pipe\aura
  -> React dashboard

React invoke("open_action")
  -> JSON line on \\.\pipe\aura-actions
  -> bridge/launch.py
```

`{"protocol":"aura","type":"hud.shown"}` on the actions pipe asks the watcher to consider once. It does not launch an app. The HUD sends it when the window becomes visible.

Collectors must not import `bridge` or `hud`. Nothing at import time may start a thread. Window activate, close, list, and capture are Tauri commands. They are not catalog ids. Window handles cross into the webview as decimal strings.

## The glass sheet

One Tauri 2 window, React and TypeScript, identifier `com.whack.aura`. It is borderless, transparent, always on top, skips the taskbar, and covers the monitor under the cursor, including the taskbar area. It is not click-through.

The visible dashboard is a rounded sheet inset 32 CSS pixels, with a 28 CSS pixel corner radius. Those numbers are `GLASS_MARGIN_CSS` and `GLASS_RADIUS_CSS` in `hud/src-tauri/src/glass.rs`, and `--glass-margin` and `--glass-radius` in `hud/src/App.css`. They must stay in step. The margin outside the sheet is transparent, so the desktop there stays sharp. Clicks in the margin still hit Aura. The real taskbar can show through that strip. It is not hidden.

The sheet is meant to show the desktop as colour and shape, with body text hard to read.

1. While Aura is still hidden, `StretchBlt` copies the desktop under the sheet, already shrunk (`BACKDROP_DOWNSCALE`, now 8).
2. `fast_blur` softens that image (`BACKDROP_BLUR_SIGMA`, now 10).
3. The result is a JPEG (`BACKDROP_LONG_EDGE`, now 1400, which sets size, not blur strength).
4. Rust emits `glass-backdrop`. React paints it on `.glass-sheet`, with a white veil (`--glass-tint`, now `rgba(255, 255, 255, 0.18)`).

The picture does not update while Aura stays open. It is taken again on the next show. If the grab fails, the sheet falls back to flat white and a weak DWM blur. Fullscreen acrylic is not used, because it would blur the margin too. `DwmEnableBlurBehindWindow` has no blur radius.

The palette is one neutral glass: white, silver, greys, a slight cool tint. There is no light/dark switch and no blur slider. Type is Segoe UI Variable, then Segoe UI. App marks on suggestions and shortcuts are drawings or initials. Window-stack previews are real screenshots.

## What is on the sheet

Panels float separately. The centre stays empty.

- **Sidebar.** Top left, left to right: Add a widget, the sidebar switch, a divider, Edit, Settings. Add opens the widget library. The switch is `panels.nav.visible` in `%LOCALAPPDATA%\aura\layout.json`. Off slides the whole ribbon away, including Add, and leaves a “Show sidebar” handle. The sidebar has no Remove, Minimise, or Hide.
- **Window stack.** One card per top-level window, not per browser tab. The selected card is centred and in front. Neighbours overlap it. This is not a carousel. Hover only highlights. A click that does not drag calls `activate_window` and dismisses Aura. Wheel, strip drag, and Left/Right change the selection and do not activate. Pointer capture starts only after the pointer moves 4 pixels (`DRAG_SLOP`). Capture on pointerdown was a bug: it swallowed the click. Down moves to suggestions. Close posts `WM_CLOSE` and leaves Aura up. Previews load in the background, at most two at a time, and refresh when a window is new, retitled, or becomes the foreground.
- **Suggestions.** Right side. Up to eight cards: the primary suggestion, then real focus history. The catalog is not used to fill empty slots. Three are shown, then “Show N more”. Empty state is “Scanning for suggestions...”. Open goes through `open_action` only.
- **Quick note.** Bottom left. A raw Markdown textarea. The collapsed chip shows the start of the source. Text autosaves to `scratchpadPath` (`C:\Users\nggro\aura-scratch.md`). The same text is the note the rules and the model see. The editor does not itself pick a card.
- **Shortcuts widget.** The only registered widget. It is not on the default layout. More than one instance is allowed. Each stores an ordered list of catalog ids and a size preset in `%LOCALAPPDATA%\aura\widget-state.json`. A new instance starts in the centre. Another copy steps one 24px grid cell. A click launches only when edit mode is off.

**Edit mode** is the nav Edit button. It is React state, not saved in the layout file. Drag and note resize happen only then. Positions are fractions of the stage. Snap is a 24px grid, on by default. Overlap is allowed. The quick note is the only freely resizable piece. Motion also stops when the OS prefers reduced motion. `animations` is a saved flag. Reset restores placement and does not change that flag.

Piece controls:

- In edit mode, the window stack, suggestions, the note, and every shortcut show Remove. The choice is Keep configuration, Delete configuration, or Cancel.
  - Shortcuts: Keep takes the instance off the stage and leaves its saved list, so it can be restored. Delete also removes that saved list.
  - Window stack and suggestions: Keep hides the panel and remembers its place. Delete hides it and restores the default place. Either can return from the library’s Hidden list.
  - Quick note: Keep hides the note and leaves the text and size. Delete hides it, clears the text, and restores the default size.
- Outside edit mode, a cog inside the top-right offers Minimise. The three built-in panels also offer Hide. Shortcut widgets do not offer Hide. A minimised piece becomes a pill. Clicking the pill restores it.

A successful open hides Aura. A failed open stays up and the error is drawn on that card.

## How a suggestion is chosen

On each context change, and when the HUD is shown:

1. If the note contains `http://`, `https://`, or `www.`, the suggestion is `open_url`. That id is not in the catalog. `www.` is rewritten to `https://`. This beats every rule.
2. Otherwise the rules in `rules/default.json` run in order. Every clause in a rule’s `when` must match. The first full match wins. Keys are `noteContains`, `clipboardContains`, `processIs`, and `titleContains`. Matching is case-insensitive.
3. On a total miss, the dashboard immediately shows a history card (“From your recent apps.”) if focus history maps to a catalog card.
4. Only then, and only once per context fingerprint, the model may answer. The fingerprint is the process, window title, note, and clipboard. A finished attempt, success or failure, is remembered. The same context is not sent again until the watcher restarts. A later failure keeps the last successful catalog id on screen.

`bridge/rank.py` turns focus history into cards. It maps a process name to a catalog id, then keeps kinds that are actually in the current action list. Frequent history comes before recent history. Unmapped processes, and ids that are not in the catalog, are skipped. The catalog order is not used to pad the list.

History is stored in SQLite. `aura.config.json` sets `historyPath` to `%LOCALAPPDATA%\aura\simulated_history.sqlite`, a fake platformer day in which Godot has the most time. `python -m memory.simulate` rebuilds it. Remove `historyPath` to record into the live history file instead. That is why an empty note still often suggests the Godot coursework card.

Tokens replaced from `aura.config.json` are `${godotProject}`, `${godotEditor}`, `${godotProjectDir}` (the folder that contains the project file), `${gitRepo}`, and `${scratchpadPath}`.

Rule order that matters:

- A note containing `platformer`, or `coursework`, or a window title containing `.gd` or `project.godot`, suggests `open_godot` (the coursework project). `platformer` is first, so it beats `discord` in the same note.
- A note containing `godot` but not those more specific words suggests `open_godot_editor` (the project manager).
- Other rules suggest an app when the note names it (`discord`, `terminal`, `spotify`, and the rest of the remaining cards).

## The model

`aura.config.json` sets `baseUrl` to `https://api.openai.com/v1`, `name` to `gpt-4o-mini`, `timeoutMs` to 8000, and leaves `apiKey` empty. The key is read from `AURA_OPENAI_API_KEY`, then from that empty config field, then from gitignored `aura.secrets.json`. The key in use is a project key. API credits are prepaid credits on that key’s organization. A ChatGPT Plus subscription does not refill them. HTTP 429 with “no credits remaining” means the API balance was empty. After credits are added, restart the watcher so a remembered failure is dropped.

The model may return one catalog id, or none. It cannot attach a search query. The reply is accepted only when it names exactly one id from the catalog.

`bridge/model.py` loads `model_instructions.md` from the repo root. That file now lives in `HandOffFiles`, so the loader does not find it and sends a short built-in sentence instead. The long brief in `HandOffFiles/model_instructions.md` is not what the live model sees until that path is pointed back at the file.

Diagnostics ride on the existing snapshot as `payload.diagnostics`. Settings opens the stage list. Stages include availability, context supplied, request delivery, and the last error. They record lengths and whether a key is present. They do not record the key, the note text, or the clipboard text. The watcher log says `Model request failed` on a bad call, and `Suggested <id> from model` when a reply names one card.

## Catalog and launch

`catalog.json` is the allowlist. A new app is a new row, not a new function. Methods are `file`, `command`, and `link`, implemented in `bridge/launch.py`. There are 28 cards.

| Id | What it opens |
| --- | --- |
| `open_godot` | Godot’s editor on the coursework project, `C:\LocalWork\cs276\Game-Dev-Coursework`, via `${godotEditor} --editor --path ${godotProjectDir}`. |
| `open_godot_editor` | The Godot project manager, `${godotEditor} --project-manager`. No project is opened. |
| `open_terminal` | `wt.exe -d ${gitRepo}`. `gitRepo` is `C:\Users\nggro\code\platformer`, which is not on disk, so `directoryFallback` opens `C:\Users\nggro` instead. If that repo folder is created, the terminal uses it. If `wt.exe` itself is missing, PowerShell is the fallback. |
| `focus_discord` | `discord:` |
| `open_vscode` | `vscode:` |
| `open_cursor` | `cursor:` |
| `open_edge` | `microsoft-edge:` |
| `open_explorer` | `explorer.exe` on `${gitRepo}`. That folder is missing, so Explorer opens Documents. This card does not use the terminal’s directory fallback. To make it open a chosen folder, set `gitRepo` to a folder that exists. |
| `open_notepad`, `open_calculator`, `open_paint`, `open_task_manager` | `notepad.exe`, `calc.exe`, `mspaint.exe`, `taskmgr.exe` |
| `open_snipping`, `open_photos`, `open_settings`, `open_store`, `open_clock`, `open_camera` | Windows protocol links (`ms-screenclip:`, `ms-photos:`, `ms-settings:`, `ms-windows-store:`, `ms-clock:`, `microsoft.windows.camera:`) |
| `open_spotify`, `open_steam`, `open_teams`, `open_whatsapp` | `spotify:`, `steam:`, `msteams:`, `whatsapp:` |
| `open_word`, `open_excel`, `open_powerpoint` | The Office program files `WINWORD.EXE`, `EXCEL.EXE`, and `POWERPNT.EXE` under `Office16`. The old `ms-word:`, `ms-excel:`, and `ms-powerpoint:` links were rejected by Office. |
| `open_onenote` | `onenote:` which does open OneNote |
| `open_powershell`, `open_command` | `powershell.exe -NoExit`, and `cmd.exe` |

Removed because they are not installed on this machine: Chrome, Firefox, Maps, Mail, Calendar, Slack, Telegram, Notion, and Figma. Their rules were removed. The ranker no longer maps those process names. Do not treat `open_chrome` as a live card. A note that says “chrome” has no Chrome rule anymore.

`.godot` files are not associated with Godot, so the coursework card must launch the editor executable. Passing the project file without `--editor` runs the game instead of opening the editor.

## Checks

From `hud/`:

```text
npx tsc --noEmit
npx tsx src/layout/navVisibility.test.ts
npx tsx src/windows/stackLayout.test.ts
npx tsx src/windows/previewFreshness.test.ts
npx tsx src/windows/stackMotion.test.ts
npx tsx src/widgets/shortcuts.test.ts
npx tsx src/widgets/library.test.ts
npx tsx src/modelDiagnostics.test.ts
```

From `hud/src-tauri`, with cargo on `PATH`:

```text
cargo test glass_sheet
```

From the repo root:

```text
python -m unittest context.tests.test_model context.tests.test_rules context.tests.test_actions context.tests.test_manager context.tests.test_scratchpad context.tests.test_rank memory.tests.test_focus_store
```

The Python line should end with `OK`.

## Not built

- The model cannot return a search query. A note such as “Research laplace function” cannot open a browser with that search filled in. `open_url` only fires when the note already contains a URL.
- Clock, weather, and any widget other than Shortcuts are not registered.
- The sheet backdrop is a still image. Live blur under the sheet was rejected when it also blurred the margin.
- The taskbar is not hidden.
- `model_instructions.md` is not loaded from `HandOffFiles`.

## Questions for the test

Ask these only after the walkthrough. Accept an answer that is right in substance.

1. What are the two processes, and which file starts both?
2. What does Ctrl+Alt+Space do, and why does the window start hidden?
3. Why must the glass margin and radius match in both Rust and CSS?
4. Why is fullscreen acrylic not used?
5. What does a click on a window-stack card do, and why must pointer capture wait until the pointer has moved?
6. Where does the quick note save, and who else reads that text?
7. What is the only registered widget, and where does a second copy start?
8. What is the difference between Keep and Delete when removing a shortcut, the note, and a panel?
9. Put these in order: a URL in the note, a matching rule, focus history, the model.
10. A note says “finish the platformer and ping discord”. Which card wins, and why?
11. A note says only “godot”. Which card wins? A note says “coursework”. Which card wins?
12. Why does an empty note often still suggest the Godot coursework project?
13. What may the model return, and what is it forbidden to attach?
14. Why does HTTP 429 appear, and why does restarting the watcher matter after credits are added?
15. Why does `open_godot` use `--editor --path` instead of opening the `.godot` file?
16. What happens when Terminal’s repo folder is missing? What does File Explorer do with that same folder?
17. Why do Word, Excel, and PowerPoint start `.exe` files instead of `ms-word:`, `ms-excel:`, and `ms-powerpoint:`?
18. Name three cards that were removed, and say why a Chrome search card is not a current feature.
19. Which process names does the ranker still map, and what happens to a history row for Slack or Chrome?
20. Where do layout fractions live relative to, and when are panels allowed to move?
