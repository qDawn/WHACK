# Aura state handoff

**Timestamp:** 2026-11-08T06:10:00Z
**Give this file to the new chat.** It is the current brief. Where an older handoff disagrees with this file, follow this file.
**Repo:** `C:\LocalWork\WHACK 2026\WHACK`
**Remote:** `https://github.com/qDawn/WHACK.git`
**Demo machine:** Windows 11, build 26200. The user is `nggro`.
**Product name:** Aura. The repo folder is WHACK. Aura is a dashboard, not an operating system.

`system_handoff.md` is the older system overview and is stale on ranking, the HUD, and the model path. `ui_handoff.md` describes the HUD before the glass overhaul and is stale. `AURA_IMPLEMENTATION_REPORT.md` matches the code up to the diagnostics work. It does **not** include the desktop snapshot blur, the window-stack click fix, the edit-mode Remove control, or the add-widget button on the ribbon. Do not add FastAPI. Do not commit unless the user asks. Do not leave `python -m bridge.watch` or `npm run tauri dev` running in an agent terminal. Do not print or commit the model key, the scratchpad text, or the clipboard.

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

The window starts hidden. **Ctrl+Alt+Space** shows and hides it. A Rust change needs a restart of `npm run tauri dev`. A CSS-only or TypeScript change can refresh.

Rust is `rustc` 1.99.1 under `%USERPROFILE%\.cargo\bin`. Prepend that directory to `PATH` before `cargo`. `link.exe` comes from Visual Studio 2022 Build Tools.

## What Aura is now

One Tauri 2 window, React, TypeScript. Identifier `com.whack.aura`. The window is borderless, transparent, always on top, skips the taskbar, and is sized to the full bounds of the monitor under the cursor, including the taskbar area. It is not click-through. Exclusive fullscreen games are out of scope. Aura does not inject into them.

The visible dashboard sits on a rounded sheet inset 32 CSS pixels from the screen, with a 28 CSS pixel corner radius. Those numbers live in both `hud/src-tauri/src/glass.rs` (`GLASS_MARGIN_CSS`, `GLASS_RADIUS_CSS`) and `hud/src/App.css` (`--glass-margin`, `--glass-radius`). Keep them in step. The margin outside the sheet is transparent, so the desktop there stays sharp. Clicks in the margin still hit Aura. The Windows taskbar can show through that strip. It was not hidden with `ShowWindow`. Do not hide `Shell_TrayWnd`.

Inside the sheet:

- **Sidebar.** The navigation ribbon, top left. Left to right: Add a widget (plus), the sidebar switch, a divider, Edit, Settings. Add opens the widget library. The switch is stored as `panels.nav.visible` in `%LOCALAPPDATA%\aura\layout.json`. Off slides the whole ribbon away, including Add, and leaves a “Show sidebar” handle on the sheet edge. There is no shortcut picker on the nav. An older `minimised` or `hidden` value loads as `visible: false`. The sidebar does not get Remove, Minimise, or Hide.
- **Window stack.** Real top-level windows, one card per window, not per browser tab. Horizontal overlapping deck from `hud/src/windows/stackLayout.ts`. The selected card is centred and in front. Neighbours overlap it. This is not a carousel and not an even row. Hover highlights only. A click that does not drag calls `activate_window`, which dismisses Aura. Wheel, strip drag, and Left/Right change the selection and do not activate. Down moves to suggestions. Close posts `WM_CLOSE` and does not dismiss Aura. Previews preload on a background thread while the window is hidden, at most two captures at once, and refresh only when a window is new, retitled, or becomes the foreground. Placeholders use `pointer-events: none`. Screenshots use `object-fit: contain`.
- **Suggestions.** Right side. Up to eight cards from the primary suggestion plus real focus history. No catalog padding. Three shown, then “Show N more”. Empty state is “Scanning for suggestions...”. Open goes through `invoke("open_action")` only.
- **Quick note.** Bottom left. Raw Markdown textarea. Collapsed chip shows the start of the source. Autosave is still `read_scratchpad` / `write_scratchpad` to `scratchpadPath`. No save badge. Note errors stay on the note. The note text is the scratchpad the rules and the model already see. The editor itself does not choose a card.
- **Workspace.** The centre of the stage is empty. There is no “Add a widget to get started” prompt. The only registered widget is Shortcuts. It is not on the default or reset layout. Multiple instances are allowed. Each instance stores ordered app ids and a size preset in `%LOCALAPPDATA%\aura\widget-state.json`. A new instance starts in the centre of the stage (`widgetOrigin` in `hud/src/layout/document.ts`). Another copy of the same type steps one 24px grid cell so it does not cover the first. Suggestions inside a shortcut widget are the live snapshot’s action kinds only. Manual adds use `list_catalog`. A click launches with `open_action` only when edit mode is off.
- **Edit mode.** The nav Edit button. Drag and the note resize happen only then. Positions are fractions of the stage. Snap is a 24px grid, on by default. Reset restores the arrangement and does not change the `animations` flag. Overlap is allowed. The quick note is the only freely resizable piece.

Piece controls, after this chat:

- **Edit mode.** Window stack, suggestions, the quick note, and every shortcut widget show Remove in the top-right. It asks Keep configuration, Delete configuration, or Cancel.
  - Shortcuts: Keep takes the instance off the stage and leaves the blob, so Restore can put the same id back. Delete also removes that blob.
  - Window stack and suggestions: Keep hides the panel and remembers its place. Delete hides it and restores the default place. Either can come back from the library’s Hidden list.
  - Quick note: Keep hides the note and leaves the text and size. Delete hides it, clears the text, and restores the default size.
- **Outside edit mode.** A cog sits inside the top-right of the window stack, suggestions, the quick note, and shortcut widgets. Open it and choose Minimise. Those three panels also still have Hide in that menu. Shortcut widgets do not offer Hide, and their cog is hidden while editing so Remove is the edit-mode control. Panels keep the cog in edit mode, beside Remove. A minimised piece becomes a pill. Clicking the pill restores it.
- The cog used to sit at `top: -28px`, outside the frame. A click only landed while the piece stayed selected in edit mode. It now sits at `top: 8px; right: 8px`, inside the frame.

Launch path, unchanged:

```text
React invoke("open_action")
  -> JSON line on \\.\pipe\aura-actions
  -> bridge/launch.py
```

A successful open hides Aura. A failed open stays up and the error is drawn on that card. New apps are rows in `catalog.json`, not new launch functions. Launch methods are `file`, `command`, and `link`.

Suggestion path, unchanged in shape:

```text
collectors
  -> ContextManager
  -> bridge/watch.py
       a URL already written in the note becomes open_url, before the rule list
       rules first, AND clauses, first match wins
       on a total miss, publish the history card immediately
       model only then, and only once per context fingerprint
  -> JSON line on \\.\pipe\aura
```

Rule keys are `noteContains`, `clipboardContains`, `processIs`, and `titleContains`. Matching is case-insensitive. Tokens `${godotProject}`, `${gitRepo}`, and `${scratchpadPath}` come from `aura.config.json`. The model may only return one id from the catalog. It cannot attach a search query. `open_url` is the only non-catalog kind, and only for a URL already in the note. `open_chrome` runs `cmd.exe /c start "" chrome` and does not type into the address bar.

`{"protocol":"aura","type":"hud.shown"}` on the actions pipe asks the watcher to consider once. It does not launch an app. The HUD sends it when the window becomes visible.

## Changes in this chat

The user confirmed the first two. The third was implemented and not clicked by an agent.

1. **Window-stack click.** Pressing a card called `setPointerCapture` on the strip immediately. That retargeted the click onto the strip, so `activate_window` never ran. Capture now starts only after the pointer moves at least `DRAG_SLOP` (4px). A press that is not a scrub activates on pointerup. The click that follows is suppressed so the window is not activated twice. Do not move capture back onto pointerdown.
2. **Remove and minimise.** Described under piece controls above. `applyPanelRemoval` in `hud/src/layout/document.ts` is the keep/delete policy for the three panels. Shortcut removal is still `applyWidgetRemoval` in `hud/src/widgets/library.ts`.
3. **Add widget.** The centre prompt and `hud/src/components/Workspace.tsx` are gone. The plus button is the leftmost control on the nav ribbon (`data-nav="add-widget"` in `hud/src/components/NavBar.tsx`). Placement of a new widget was not changed.

`npx tsc --noEmit` in `hud/` passed after each of these. Also passed, in `hud/`: `navVisibility.test.ts`, `stackLayout.test.ts`, `stackMotion.test.ts`, `shortcuts.test.ts`, and `library.test.ts`. Python unittest and `cargo test glass_sheet` were not run again. No HUD process was left running.

## Sheet backdrop

Unchanged in this chat. The user wanted the sheet to show the desktop as colour and shape, with body text unreadable, in the spirit of Apple’s liquid-glass overlay.

`DwmEnableBlurBehindWindow` is still applied to the rounded region, with the system backdrop forced to `DWMSBT_NONE`, because fullscreen acrylic would blur the margin too. That API has **no blur radius**. On Windows 11 the result stays sharp enough to read.

The sheet background is a snapshot taken while Aura is still hidden, before `window.show()`:

1. `StretchBlt` copies the desktop under the sheet, already shrunk.
2. `image::imageops::fast_blur` softens that small image.
3. The result is a JPEG data URL.
4. `lib.rs` emits `glass-backdrop` with `{ image }`.
5. `App.tsx` paints it on `.glass-sheet`. A `::after` veil uses `--glass-tint`.

The margin is not part of the image, so it stays a live, sharp view of the desktop. The picture does not update while Aura stays open. It is taken again on the next show. If the grab fails, the sheet falls back to a flat white fill and the weak DWM blur.

| Knob | File | Now | Effect |
| --- | --- | --- | --- |
| `BACKDROP_DOWNSCALE` | `hud/src-tauri/src/glass.rs` | `8` | Main blur. Higher makes words harder to read. |
| `BACKDROP_BLUR_SIGMA` | same file | `10` | Extra blur on the shrunk image. |
| `BACKDROP_LONG_EDGE` | same file | `1400` | JPEG size after the blur. Not the blur strength. |
| `--glass-tint` | `hud/src/App.css` | `rgba(255, 255, 255, 0.18)` | White veil over the snapshot. Lower shows more of the blur. |

## What to do next

The user asked for these two, in this order. Do the catalog pass before the note parser. Do not start the note work by adding cards.

1. **Walk every catalog card on this machine.** `catalog.json` has 36 entries, from `open_godot` through `open_figma`. Launch each the real way, through `open_action` and `bridge/launch.py`, not by inventing a second launcher. If the app or process is not installed, or the launch fails because the target does not exist, delete that entry. Also delete every rule in `rules/default.json` whose `suggest.kind` was that id, and drop the id from any shortcut list in `%LOCALAPPDATA%\aura\widget-state.json`. Do not replace a missing app with a different one in this pass. Do not add a card. Leave entries that actually open.
2. **Then design note understanding. Do not add the new cards yet.** The user wants the existing suggestion path to read the quick note and propose a relevant card, using both the rules and natural-language parsing. Example: the note says `Research laplace function`. The suggested card should open Google Chrome and put `laplace function` in the search bar. A rule that only checks `noteContains: "chrome"` cannot do that, and today’s `open_chrome` starts Chrome with no query. `open_url` only fires when the note already contains `http://`, `https://`, or `www.`. The model in `bridge/model.py` sees `note:` in its prompt and may return one catalog id. It cannot return a query. Prefer that model. Add a second agent only if this path cannot carry the suggestion. Do not launch Chrome, or any URL, from React. Figure out how the query rides along the existing action pipe, and how a rule hit and a model reading of the same note stay one suggestion rather than two competing cards. After that design is settled, new catalog rows can be added. Not before.

## Still open, not the next task

Do not treat these as the work to start. They are leftover gaps.

1. **Look at the snapshot blur on the real window.** Tune the knobs above only after seeing it. The user wants shapes and colours, not readable words, and not a flat white plate.
2. **The blur is a still.** If the user wants the desktop to keep moving under the sheet, that needs a different technique. Do not turn fullscreen acrylic back on. That blurs the margin, which the user rejected.
3. **Taskbar.** It can show through the clear margin. Clicks there hit Aura. Hiding the real taskbar was deliberately not done.
4. **Live model.** The key is in gitignored `aura.secrets.json` or `AURA_OPENAI_API_KEY`. `aura.config.json` keeps `apiKey` empty. A rule miss still shows the history card first (`From your recent apps.`). A failed model call is remembered per context, and the last successful catalog id stays up if a later call fails. Diagnostics are `payload.diagnostics` on the existing snapshot. Settings opens the stage list. Do not put the key, note body, or clipboard text in diagnostics or logs.
5. **More widgets.** The registry only contains Shortcuts. Clock, weather, and the other ideas in the original brief are not built. A new widget is one registration: type, title, description, fixed size variants, a static `Preview`, and a `Widget`. Set `allowMultiple` only when a second copy makes sense.

## Design notes

- One neutral glass palette. White, silver, light and medium greys, a slight cool tint. No light/dark switch, no accent-colour setting, no blur-intensity slider. The constants above are code knobs, not a settings UI.
- Type is `"Segoe UI Variable", "Segoe UI", sans-serif`. Do not bundle San Francisco.
- App marks on suggestions and shortcuts are static drawings or initials. Do not claim they are live windows. Window-stack previews are real static screenshots of that window.
- Glass panels float separately inside the sheet. They are not one connected page. The centre stays empty. Add lives on the ribbon.
- Edit mode is the only time panels move. The flag is React state `editMode` / `data-editing` on `.dashboard`. It is not stored in the layout file. `animations` is a top-level boolean in the layout file. Motion also stops when the OS prefers reduced motion.
- Do not launch apps, files, or URLs from React. Do not bypass the action pipe. Do not replace the Python watcher, the collectors, or the ranker. Collectors must not import `bridge` or `hud`. Nothing at import time may start a thread or call `join`.
- Window activate, close, list, and capture are Tauri commands. They are not catalog ids.
- HWNDs cross the webview as decimal strings.
- The window stack’s selection index is the only selection. Preview, title, and the front card all read it. Hover must not write it. Do not queue a second animation target. Do not capture the pointer on the strip’s pointerdown.
- Do not put Minimise, Hide, or Remove on the sidebar. Shortcut widgets minimise from the cog outside edit mode and do not offer Hide.
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

The Python line should end with `OK`. In this chat, `tsc` and the nav, stack layout, stack motion, shortcuts, and library tests passed. `previewFreshness`, `modelDiagnostics`, `cargo test glass_sheet`, and the Python suites were not run again. None of them open the HUD.
