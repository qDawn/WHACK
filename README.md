# Aura

Aura is a Windows dashboard that sits over the desktop. It suggests a next app, shows the windows already open, keeps a quick note, and can pin shortcut widgets. The repo folder is WHACK. Aura does not replace Windows and does not launch apps from the React UI.

The full picture of how it works, including the catalog and the suggestion rules, is in [HandOffFiles/project_guide.md](HandOffFiles/project_guide.md). Older notes in that folder are stale where they disagree with that guide.

## Run the demo

Windows 11. Two processes, and Tauri does not start Python.

Double-click `start-demo.bat`, or run it from this folder. It opens two windows:

- **Aura watcher** runs `python -m bridge.watch` here.
- **Aura HUD** runs `npm run tauri dev` in `hud`, with Rust’s tools on that window’s `PATH`.

Or start them yourself:

```text
python -m bridge.watch
```

```text
cd hud
npm run tauri dev
```

The window starts hidden. **Ctrl+Alt+Space** shows and hides it. Close a window, or press Ctrl+C in it, to stop that process. A Rust change needs the HUD process restarted. A CSS or TypeScript change can refresh.

Rust lives under `%USERPROFILE%\.cargo\bin`. `link.exe` comes from Visual Studio 2022 Build Tools.

## What you see

One borderless window, sized to the monitor under the cursor. The dashboard is a rounded sheet inset from the screen. The margin outside the sheet stays a sharp view of the desktop.

- **Sidebar.** Add a widget, hide the ribbon, Edit, and Settings.
- **Window stack.** One card per real window. A click that does not drag activates that window and hides Aura.
- **Suggestions.** Up to eight cards. A URL in the note wins, then the first matching rule, then focus history. The model is asked only when nothing else matched.
- **Quick note.** Markdown, saved to the scratchpad path in `aura.config.json`. The rules and the model read the same text.
- **Shortcuts.** The only widget. More than one copy is allowed. Clicks launch only when Edit is off.

Edit mode is the only time panels move. Remove asks whether to keep or delete that piece’s saved configuration.

## Where things live

| Piece | File |
| --- | --- |
| Apps the dashboard can open | `catalog.json` |
| How an app is started | `bridge/launch.py` |
| Suggestion rules | `rules/default.json` |
| Paths, hotkey, model name | `aura.config.json` |
| API key | `aura.secrets.json` or `AURA_OPENAI_API_KEY`. The config file leaves `apiKey` empty. |
| Focus history used for suggestions | The `historyPath` in `aura.config.json` |
| Layout and shortcut widgets | `%LOCALAPPDATA%\aura\` |

A new app is a new row in `catalog.json`, not a new launch function. Open still goes through the action pipe into `bridge/launch.py`.

## Checks

From `hud`:

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

From this folder:

```text
python -m unittest context.tests.test_model context.tests.test_rules context.tests.test_actions context.tests.test_manager context.tests.test_scratchpad context.tests.test_rank memory.tests.test_focus_store
```
