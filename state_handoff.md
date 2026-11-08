# Aura state handoff

**Timestamp:** 2026-11-08T05:30:00Z
**Give this file to the new chat.** It is the current brief. Where an older handoff disagrees with this file, follow this file.
**Repo:** `C:\LocalWork\WHACK 2026\WHACK`
**Remote:** `https://github.com/qDawn/WHACK.git`
**Demo machine:** Windows 11, build 26200. The user is `nggro`.
**Product name:** Aura. The repo folder is WHACK. Aura is a dashboard, not an operating system.

`system_handoff.md` is the older system overview and is stale on ranking, the HUD, and the model path. `ui_handoff.md` describes the HUD before the glass overhaul and is stale. `AURA_IMPLEMENTATION_REPORT.md` matches the code up to the diagnostics work. It does **not** include the desktop snapshot blur described below. Do not add FastAPI. Do not commit unless the user asks. Do not leave `python -m bridge.watch` or `npm run tauri dev` running in an agent terminal. Do not print or commit the model key, the scratchpad text, or the clipboard.

## How the user runs it

Two processes. Tauri does not spawn Python.

```text
cd "C:\LocalWork\WHACK 2026\WHACK"
python -m bridge.watch
```

```text
cd "C:\LocalWork\WHACK 2026\WHACK\hud"
npm run tauri dev
```

The window starts hidden. **Ctrl+Alt+Space** shows and hides it. A Rust change needs a restart of `npm run tauri dev`. A CSS-only change can refresh.

Rust is `rustc` 1.99.1 under `%USERPROFILE%\.cargo\bin`. Prepend that directory to `PATH` before `cargo`. `link.exe` comes from Visual Studio 2022 Build Tools.

## What Aura is now

One Tauri 2 window, React, TypeScript. Identifier `com.whack.aura`. The window is borderless, transparent, always on top, skips the taskbar, and is sized to the full bounds of the monitor under the cursor, including the taskbar area. It is not click-through. Exclusive fullscreen games are out of scope. Aura does not inject into them.

The visible dashboard sits on a rounded sheet inset 32 CSS pixels from the screen, with a 28 CSS pixel corner radius. Those numbers live in both `hud/src-tauri/src/glass.rs` (`GLASS_MARGIN_CSS`, `GLASS_RADIUS_CSS`) and `hud/src/App.css` (`--glass-margin`, `--glass-radius`). Keep them in step. The margin outside the sheet is transparent, so the desktop there stays sharp. Clicks in the margin still hit Aura. The Windows taskbar can show through that strip. It was not hidden with `ShowWindow`. Do not hide `Shell_TrayWnd`.

Inside the sheet:

- **Sidebar.** The navigation panel. One switch at the top, stored as `panels.nav.visible` in `%LOCALAPPDATA%\aura\layout.json`. Off slides it away and leaves a “Show sidebar” handle on the sheet edge. Edit and Settings stay. There is no shortcut picker on the nav. An older `minimised` or `hidden` value loads as `visible: false`.
- **Window stack.** Real top-level windows, one card per window, not per browser tab. Horizontal overlapping deck from `hud/src/windows/stackLayout.ts`. The selected card is centred and in front. Neighbours overlap it. This is not a carousel and not an even row. Hover highlights only. Click calls `activate_window`, which dismisses Aura. Wheel, strip drag, and Left/Right change the selection and do not activate. Down moves to suggestions. Close posts `WM_CLOSE` and does not dismiss Aura. Previews preload on a background thread while the window is hidden, at most two captures at once, and refresh only when a window is new, retitled, or becomes the foreground. Placeholders use `pointer-events: none`. Screenshots use `object-fit: contain`.
- **Suggestions.** Right side. Up to eight cards from the primary suggestion plus real focus history. No catalog padding. Three shown, then “Show N more”. Empty state is “Scanning for suggestions...”. Open goes through `invoke("open_action")` only.
- **Quick note.** Bottom left. Raw Markdown textarea. Collapsed chip shows the start of the source. Autosave is still `read_scratchpad` / `write_scratchpad` to `scratchpadPath`. No save badge. Note errors stay on the note.
- **Workspace.** Empty until the user adds a widget. The only registered widget is Shortcuts. It is not on the default or reset layout. Multiple instances are allowed. Each instance stores ordered app ids and a size preset in `%LOCALAPPDATA%\aura\widget-state.json`. Suggestions inside a shortcut widget are the live snapshot’s action kinds only. Manual adds use `list_catalog`. A click launches with `open_action` only when edit mode is off. Remove, in edit mode, asks Keep, Delete, or Cancel. Keep leaves the blob so Restore can put the same id back.
- **Edit mode.** The nav Edit button. Drag and the note resize happen only then. Positions are fractions of the stage. Snap is a 24px grid, on by default. Reset restores the arrangement and does not change the `animations` flag. Overlap is allowed. The quick note is the only freely resizable piece.

Launch path, unchanged:

```text
React invoke("open_action")
  -> JSON line on \\.\pipe\aura-actions
  -> bridge/launch.py
```

A successful open hides Aura. A failed open stays up and the error is drawn on that card. New apps are rows in `catalog.json`, not new launch functions.

Suggestion path, unchanged in shape:

```text
collectors
  -> ContextManager
  -> bridge/watch.py
       rules first
       on a total miss, publish the history card immediately
       model only then, and only once per context fingerprint
  -> JSON line on \\.\pipe\aura
```

`{"protocol":"aura","type":"hud.shown"}` on the actions pipe asks the watcher to consider once. It does not launch an app. The HUD sends it when the window becomes visible.

## Most recent change

The user wanted the sheet to show the desktop as colour and shape, with body text unreadable, in the spirit of Apple’s liquid-glass overlay. The white tint alone could not do that.

`DwmEnableBlurBehindWindow` is still applied to the rounded region, with the system backdrop forced to `DWMSBT_NONE`, because fullscreen acrylic would blur the margin too. That API has **no blur radius**. On Windows 11 the result stays sharp enough to read.

The sheet background is now a snapshot taken while Aura is still hidden, before `window.show()`:

1. `StretchBlt` copies the desktop under the sheet, already shrunk.
2. `image::imageops::fast_blur` softens that small image.
3. The result is a JPEG data URL.
4. `lib.rs` emits `glass-backdrop` with `{ image }`.
5. `App.tsx` paints it on `.glass-sheet`. A `::after` veil uses `--glass-tint`.

The margin is not part of the image, so it stays a live, sharp view of the desktop. The picture does not update while Aura stays open. It is taken again on the next show. If the grab fails, the sheet falls back to a flat white fill and the weak DWM blur.

Knobs, if the next look pass needs them:

| Knob | File | Now | Effect |
| --- | --- | --- | --- |
| `BACKDROP_DOWNSCALE` | `hud/src-tauri/src/glass.rs` | `8` | Main blur. Higher makes words harder to read. |
| `BACKDROP_BLUR_SIGMA` | same file | `10` | Extra blur on the shrunk image. |
| `BACKDROP_LONG_EDGE` | same file | `1400` | JPEG size after the blur. Not the blur strength. |
| `--glass-tint` | `hud/src/App.css` | `rgba(255, 255, 255, 0.18)` | White veil over the snapshot. Lower shows more of the blur. |

This snapshot path was not watched on a live window. `cargo test glass_sheet` passed after it was added: the older inset tests plus shrink and base64 tests (5 tests). `npx tsc --noEmit` in `hud/` passed. No HUD process was left running.

## What may still need doing

Do not treat these as a commitment to build them. They are the open gaps.

1. **Look at the snapshot blur on the real window.** Tune `BACKDROP_DOWNSCALE`, `BACKDROP_BLUR_SIGMA`, and `--glass-tint` only after seeing it. The user wants shapes and colours, not readable words, and not a flat white plate.
2. **The blur is a still.** If the user wants the desktop to keep moving under the sheet, that needs a different technique. Do not “fix” it by turning fullscreen acrylic back on. That blurs the margin, which the user rejected.
3. **Taskbar.** It can show through the clear margin. Clicks there hit Aura. Hiding the real taskbar was deliberately not done.
4. **Nothing in the HUD has been clicked by an agent.** Sidebar slide, stack, previews, shortcut launch, the Keep/Delete dialog, diagnostics, and this backdrop all need a human pass on the machine.
5. **Live model.** The key is in gitignored `aura.secrets.json` or `AURA_OPENAI_API_KEY`. `aura.config.json` keeps `apiKey` empty. A rule miss still shows the history card first (`From your recent apps.`). The 7 November Godot card was that history card, not a model answer. A failed model call is now remembered per context, and the last successful catalog id stays up if a later call fails. No live OpenAI call was made, so the old HTTP status was not reproduced. Diagnostics are `payload.diagnostics` on the existing snapshot. Settings opens the stage list. Do not put the key, note body, or clipboard text in diagnostics or logs.
6. **More widgets.** The registry only contains Shortcuts. Clock, weather, and the other ideas in the original brief are not built. A new widget is one registration: type, title, description, fixed size variants, a static `Preview`, and a `Widget`. Set `allowMultiple` only when a second copy makes sense.
7. **Panels other than the sidebar** still have Minimise and Hide on their gear. The sidebar does not. Do not add those two buttons back onto the sidebar or onto widgets.

## Design notes

- One neutral glass palette. White, silver, light and medium greys, a slight cool tint. No light/dark switch, no accent-colour setting, no blur-intensity slider. The constants above are code knobs, not a settings UI.
- Type is `"Segoe UI Variable", "Segoe UI", sans-serif`. Do not bundle San Francisco.
- App marks on suggestions and shortcuts are static drawings or initials. Do not claim they are live windows. Window-stack previews are real static screenshots of that window.
- Glass panels float separately inside the sheet. They are not one connected page. The centre starts empty.
- Edit mode is the only time panels move. The flag is React state `editMode` / `data-editing` on `.dashboard`. It is not stored in the layout file. `animations` is a top-level boolean in the layout file. Motion also stops when the OS prefers reduced motion.
- Do not launch apps, files, or URLs from React. Do not bypass the action pipe. Do not replace the Python watcher, the collectors, or the ranker. Collectors must not import `bridge` or `hud`. Nothing at import time may start a thread or call `join`.
- Window activate, close, list, and capture are Tauri commands. They are not catalog ids.
- HWNDs cross the webview as decimal strings.
- The window stack’s selection index is the only selection. Preview, title, and the front card all read it. Hover must not write it. Do not queue a second animation target.
- Layout fractions are relative to the stage inside the sheet. Do not mix `monitor.size()` physical pixels into CSS lengths. The native window uses physical pixels. The blur grab uses physical pixels. CSS uses CSS pixels.

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

From the `WHACK` directory:

```text
python -m unittest context.tests.test_model context.tests.test_rules context.tests.test_actions context.tests.test_manager context.tests.test_scratchpad context.tests.test_rank memory.tests.test_focus_store
```

The Python line should end with `OK`. Those suites were last recorded as passing before this backdrop change, except `cargo test glass_sheet` and `tsc`, which were run again after the snapshot blur and passed. None of them open the HUD.
