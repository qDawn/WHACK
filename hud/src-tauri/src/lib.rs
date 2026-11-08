use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{Emitter, Manager};

mod glass;
mod window_switcher;

#[derive(Clone, serde::Serialize)]
struct SuggestionView {
    title: String,
    detail: String,
    reason: String,
    source: String,
    kind: String,
}

#[derive(Clone, serde::Serialize)]
struct HudVisibility {
    visible: bool,
}

#[derive(Clone, serde::Serialize)]
struct HudClosing {
    generation: u64,
}

#[derive(Clone, serde::Serialize)]
struct GlassBackdrop {
    image: String,
}

struct DismissGate {
    generation: u64,
    closing: bool,
}

#[derive(Clone, serde::Serialize)]
struct HudErrorView {
    message: String,
    kind: Option<String>,
}

fn fixture_path() -> Result<PathBuf, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let from_crate = manifest.join("../../fixtures/suggestion.json");
    if from_crate.exists() {
        return Ok(from_crate);
    }

    let cwd = std::env::current_dir().map_err(|error| error.to_string())?;
    for relative in ["../fixtures/suggestion.json", "fixtures/suggestion.json"] {
        let candidate = cwd.join(relative);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Could not find fixtures/suggestion.json from {}",
        manifest.display()
    ))
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn configured_scratchpad_path() -> Result<PathBuf, String> {
    let root = repo_root();
    let config: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join("aura.config.json")).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let path = config
        .get("scratchpadPath")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "aura.config.json has no scratchpadPath".to_string())?;
    let path = PathBuf::from(path);
    Ok(if path.is_absolute() {
        path
    } else {
        root.join(path)
    })
}

#[tauri::command]
fn read_scratchpad() -> Result<String, String> {
    match std::fs::read_to_string(configured_scratchpad_path()?) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn write_scratchpad(text: String) -> Result<(), String> {
    let path = configured_scratchpad_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, text).map_err(|error| error.to_string())
}

fn aura_dir() -> Result<PathBuf, String> {
    let base = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA is not set".to_string())?;
    Ok(PathBuf::from(base).join("aura"))
}

fn read_aura_file(name: &str) -> Result<String, String> {
    match std::fs::read_to_string(aura_dir()?.join(name)) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_aura_file(name: &str, text: String) -> Result<(), String> {
    let directory = aura_dir()?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    std::fs::write(directory.join(name), text).map_err(|error| error.to_string())
}

/// `%LOCALAPPDATA%\aura\layout.json`
/// The string is stored as given. Panel geometry lives under `panels`.
/// The frontend writes `animations` and unknown top-level keys back with the positions.
#[tauri::command]
fn read_layout() -> Result<String, String> {
    read_aura_file("layout.json")
}

#[tauri::command]
fn write_layout(text: String) -> Result<(), String> {
    write_aura_file("layout.json", text)
}

/// `%LOCALAPPDATA%\aura\widget-state.json`
/// Kept separate from the layout file. The scratchpad remains the note text.
#[tauri::command]
fn read_widget_state() -> Result<String, String> {
    read_aura_file("widget-state.json")
}

#[tauri::command]
fn write_widget_state(text: String) -> Result<(), String> {
    write_aura_file("widget-state.json", text)
}

#[derive(Clone, serde::Serialize)]
struct CatalogItem {
    id: String,
    title: String,
}

/// Read-only `{ id, title }` rows from `catalog.json` at the repo root.
/// Does not launch anything.
#[tauri::command]
fn list_catalog() -> Result<Vec<CatalogItem>, String> {
    let raw = std::fs::read(repo_root().join("catalog.json")).map_err(|error| error.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&raw).map_err(|error| error.to_string())?;
    let entries = value
        .get("entries")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "catalog.json has no entries".to_string())?;
    let mut items = Vec::new();
    for entry in entries {
        let Some(id) = entry.get("id").and_then(serde_json::Value::as_str) else {
            continue;
        };
        if id.is_empty() {
            continue;
        }
        let title = entry
            .get("title")
            .and_then(serde_json::Value::as_str)
            .filter(|title| !title.is_empty())
            .unwrap_or(id);
        items.push(CatalogItem {
            id: id.to_string(),
            title: title.to_string(),
        });
    }
    Ok(items)
}

#[tauri::command]
fn read_suggestion() -> Result<SuggestionView, String> {
    let raw = std::fs::read_to_string(fixture_path()?).map_err(|error| error.to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let suggestion = value
        .pointer("/payload/suggestion")
        .ok_or_else(|| "Fixture has no payload.suggestion".to_string())?;

    fn text(value: &serde_json::Value, key: &str) -> String {
        value
            .get(key)
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_string()
    }

    Ok(SuggestionView {
        title: text(suggestion, "title"),
        detail: text(suggestion, "detail"),
        reason: text(suggestion, "reason"),
        source: text(suggestion, "source"),
        kind: text(suggestion, "kind"),
    })
}

fn emit_visibility(app: &tauri::AppHandle, visible: bool) {
    let _ = app.emit("hud-visibility", HudVisibility { visible });
}

/// Sizes the window to the full bounds of the monitor under the cursor
/// (monitor position + size, including the taskbar) and clips the blur to the
/// inset rounded sheet. The clear margin still belongs to this window, so the
/// taskbar is covered and is not a click target. Aura does not hide the taskbar.
/// Exclusive fullscreen games are a known limitation; Aura does not inject into them.
fn fit_cursor_monitor(window: &tauri::WebviewWindow) -> bool {
    let Some(monitor) = monitor_under_cursor(window) else {
        return false;
    };
    let origin = monitor.position();
    let size = monitor.size();
    let _ = window.set_position(tauri::PhysicalPosition::new(origin.x, origin.y));
    let _ = window.set_size(tauri::PhysicalSize::new(size.width, size.height));
    apply_glass_blur(window, size.width, size.height);
    true
}

fn emit_backdrop(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let Some(monitor) = monitor_under_cursor(window) else {
        return;
    };
    let origin = monitor.position();
    let size = monitor.size();
    let scale = window.scale_factor().unwrap_or(1.0);
    let Some(image) = glass::capture_backdrop(origin.x, origin.y, size.width, size.height, scale) else {
        return;
    };
    let _ = app.emit("glass-backdrop", GlassBackdrop { image });
}

fn apply_glass_blur(window: &tauri::WebviewWindow, width: u32, height: u32) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    glass::apply_glass_blur(hwnd, width, height, scale);
}

fn monitor_under_cursor(window: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    if let Ok(cursor) = window.cursor_position() {
        if let Ok(Some(monitor)) = window.monitor_from_point(cursor.x, cursor.y) {
            return Some(monitor);
        }
    }
    window.primary_monitor().ok().flatten()
}

/// Caller must be on the UI thread. Shows or hides without waiting on the exit animation.
fn apply_visible(app: &tauri::AppHandle, visible: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if visible {
        fit_cursor_monitor(&window);
        // Grab the desktop before the window covers it. A later fit must not
        // capture Aura itself.
        emit_backdrop(app, &window);
        let _ = window.show();
        // The taskbar is also topmost; set this again after show so Aura is above it.
        // The window still covers the monitor. The blur region is inset; the margin
        // stays clear and is not click-through.
        let _ = window.set_always_on_top(true);
        if !fit_cursor_monitor(&window) {
            if let Ok(size) = window.inner_size() {
                apply_glass_blur(&window, size.width, size.height);
            }
        }
        let _ = window.set_focus();
    } else {
        let _ = window.hide();
    }
    emit_visibility(app, visible);
}

fn set_window_visible(app: &tauri::AppHandle, visible: bool) {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || apply_visible(&app_handle, visible));
}

fn with_dismiss<T>(app: &tauri::AppHandle, body: impl FnOnce(&mut DismissGate) -> T) -> T {
    let state = app.state::<Mutex<DismissGate>>();
    let mut gate = state.lock().unwrap_or_else(|poison| poison.into_inner());
    body(&mut gate)
}

/// Drops a close that has not finished so a late `finish_dismiss` cannot hide
/// a window that was shown again or hidden by another path.
fn invalidate_close(app: &tauri::AppHandle) {
    with_dismiss(app, |gate| {
        gate.generation = gate.generation.wrapping_add(1);
        gate.closing = false;
    });
}

fn begin_close(app: &tauri::AppHandle) {
    let generation = with_dismiss(app, |gate| {
        if gate.closing {
            return None;
        }
        gate.generation = gate.generation.wrapping_add(1);
        gate.closing = true;
        Some(gate.generation)
    });
    let Some(generation) = generation else {
        return;
    };
    let _ = app.emit("hud-closing", HudClosing { generation });
}

fn hide_immediately(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        invalidate_close(&app_handle);
        apply_visible(&app_handle, false);
    });
}

fn hide_window(app: &tauri::AppHandle) {
    hide_immediately(app);
}

/// Immediate hide. Escape and the hotkey use `begin_dismiss` so the exit
/// animation can finish first.
#[tauri::command]
fn dismiss_aura(app: tauri::AppHandle) {
    hide_immediately(&app);
}

/// Escape and Ctrl+Alt+Space. Emits `hud-closing` and leaves the window up.
#[tauri::command]
fn begin_dismiss(app: tauri::AppHandle) {
    begin_close(&app);
}

/// Hides after the exit animation when `generation` is still the active close.
#[tauri::command]
fn finish_dismiss(app: tauri::AppHandle, generation: u64) {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let should_hide = with_dismiss(&app_handle, |gate| {
            if !gate.closing || gate.generation != generation {
                return false;
            }
            gate.closing = false;
            true
        });
        if should_hide {
            apply_visible(&app_handle, false);
        }
    });
}

fn handle_pipe_line(app: &tauri::AppHandle, line: &str) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    match value.get("type").and_then(|item| item.as_str()) {
        Some("hud.hide") => hide_window(app),
        Some("hud.error") => {
            let message = value
                .get("message")
                .and_then(|item| item.as_str())
                .filter(|item| !item.is_empty())
                .unwrap_or("Open failed")
                .to_string();
            let kind = value
                .get("kind")
                .and_then(|item| item.as_str())
                .filter(|item| !item.is_empty())
                .map(str::to_string);
            let _ = app.emit("hud-error", HudErrorView { message, kind });
        }
        _ => {
            if let Some(payload) = value.get("payload").cloned() {
                let _ = app.emit("snapshot", payload);
            }
        }
    }
}

fn listen_for_snapshots(app: tauri::AppHandle) {
    loop {
        match std::fs::File::open(r"\\.\pipe\aura") {
            Ok(file) => {
                for line in BufReader::new(file).lines() {
                    let Ok(line) = line else { break };
                    handle_pipe_line(&app, &line);
                }
            }
            Err(_) => thread::sleep(Duration::from_millis(400)),
        }
    }
}

fn write_action_line(line: &str) -> Result<(), String> {
    let mut last_error = String::from("Watcher is not running");
    for _ in 0..8 {
        match OpenOptions::new()
            .write(true)
            .open(r"\\.\pipe\aura-actions")
        {
            Ok(mut pipe) => {
                pipe.write_all(line.as_bytes()).map_err(|error| error.to_string())?;
                return Ok(());
            }
            Err(error) => {
                last_error = error.to_string();
                thread::sleep(Duration::from_millis(80));
            }
        }
    }
    Err(last_error)
}

#[tauri::command]
fn open_action(kind: String) -> Result<(), String> {
    if kind.is_empty()
        || !kind
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return Err("Unknown action".to_string());
    }
    write_action_line(&format!("{{\"kind\":\"{kind}\"}}\n"))
}

/// Not a launch. Python ignores this type and runs one consider.
#[tauri::command]
fn notify_hud_shown() -> Result<(), String> {
    write_action_line("{\"protocol\":\"aura\",\"type\":\"hud.shown\"}\n")
}

// Exclusive fullscreen games cannot be covered. Aura does not inject into them.
// Handles cross the bridge as decimal strings; a 64-bit HWND does not fit in a JavaScript number.
// These commands do not use the catalog action pipe.
#[tauri::command]
fn list_windows(app: tauri::AppHandle) -> Result<window_switcher::WindowList, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Aura window is not open".to_string())?;
    let own = window.hwnd().map_err(|error| error.to_string())?;
    window_switcher::set_own_hwnd(own);
    Ok(window_switcher::WindowList {
        windows: window_switcher::list_windows(own)?,
        foreground_hwnd: window_switcher::foreground_hwnd(),
    })
}

#[tauri::command]
async fn capture_window(hwnd: String, cache_only: Option<bool>) -> window_switcher::WindowPreview {
    let cache_only = cache_only.unwrap_or(false);
    match tauri::async_runtime::spawn_blocking(move || window_switcher::capture_window(&hwnd, cache_only)).await {
        Ok(preview) => preview,
        Err(_) => window_switcher::WindowPreview {
            image: None,
            error: Some("Preview unavailable".to_string()),
            revision: 0,
        },
    }
}

const PREVIEW_POLL: Duration = Duration::from_millis(1500);

fn preview_preload_loop(app: tauri::AppHandle) {
    let mut previous = Vec::new();
    let mut previous_foreground: Option<String> = None;
    loop {
        let Some(window) = app.get_webview_window("main") else {
            thread::sleep(Duration::from_millis(200));
            continue;
        };
        let Ok(own) = window.hwnd() else {
            thread::sleep(Duration::from_millis(200));
            continue;
        };
        if own.0.is_null() {
            thread::sleep(Duration::from_millis(200));
            continue;
        }
        window_switcher::set_own_hwnd(own);
        let next = match window_switcher::list_windows(own) {
            Ok(windows) => windows,
            Err(_) => {
                thread::sleep(PREVIEW_POLL);
                continue;
            }
        };
        let foreground = window_switcher::foreground_hwnd();
        let dirty = window_switcher::dirty_windows(
            &previous,
            &next,
            foreground.as_deref(),
            previous_foreground.as_deref(),
        );
        capture_dirty(&app, &dirty);
        window_switcher::prune_generations(&next);
        previous = next;
        previous_foreground = foreground;
        thread::sleep(PREVIEW_POLL);
    }
}

fn capture_dirty(app: &tauri::AppHandle, hwnds: &[String]) {
    if hwnds.is_empty() {
        return;
    }
    let pending = Mutex::new(hwnds.to_vec());
    let workers = hwnds.len().min(2);
    thread::scope(|scope| {
        for _ in 0..workers {
            let pending = &pending;
            let app = app.clone();
            scope.spawn(move || {
                loop {
                    let hwnd = {
                        let mut pending = pending.lock().unwrap_or_else(|poison| poison.into_inner());
                        pending.pop()
                    };
                    let Some(hwnd) = hwnd else {
                        break;
                    };
                    let update = window_switcher::refresh_preview(&hwnd);
                    let _ = app.emit("window-preview", update);
                }
            });
        }
    });
}

#[tauri::command]
fn activate_window(app: tauri::AppHandle, hwnd: String) -> Result<(), String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = (|| {
            let parsed = window_switcher::parse_hwnd(&hwnd)?;
            window_switcher::raise_window(parsed)
        })();
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Could not bring that window forward.".to_string())??;
    // Hide immediately. Do not wait for the exit animation: Aura would keep covering the window just focused.
    hide_immediately(&app);
    Ok(())
}

#[tauri::command]
fn close_window(hwnd: String) -> Result<(), String> {
    // Do not hide Aura. Elevated windows may reject WM_CLOSE; the card shows that error.
    window_switcher::close_window(&hwnd)
}

fn toggle_window(app: &tauri::AppHandle) {
    // The hotkey handler already runs this on the UI thread, so the decision and
    // the show/hide stay in one turn. A queued finish_dismiss cannot land between them.
    let closing = with_dismiss(app, |gate| gate.closing);
    if closing {
        invalidate_close(app);
        apply_visible(app, true);
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if matches!(window.is_visible(), Ok(true)) {
        begin_close(app);
    } else {
        apply_visible(app, true);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(DismissGate {
            generation: 0,
            closing: false,
        }))
        .invoke_handler(tauri::generate_handler![
            read_suggestion,
            open_action,
            notify_hud_shown,
            read_scratchpad,
            write_scratchpad,
            read_layout,
            write_layout,
            read_widget_state,
            write_widget_state,
            list_catalog,
            dismiss_aura,
            begin_dismiss,
            finish_dismiss,
            list_windows,
            capture_window,
            activate_window,
            close_window
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                fit_cursor_monitor(&window);
                if let Ok(hwnd) = window.hwnd() {
                    window_switcher::set_own_hwnd(hwnd);
                }
            }
            let preload = app.handle().clone();
            thread::spawn(move || preview_preload_loop(preload));
            let handle = app.handle().clone();
            thread::spawn(move || listen_for_snapshots(handle));

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                let shortcut =
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(|app, _shortcut, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            let app_handle = app.clone();
                            let _ = app.run_on_main_thread(move || toggle_window(&app_handle));
                        })
                        .build(),
                )?;

                if let Err(error) = app.global_shortcut().register(shortcut) {
                    eprintln!("Aura could not register Ctrl+Alt+Space: {error}");
                    eprintln!("Showing the panel so it is not stuck hidden.");
                    set_window_visible(app.handle(), true);
                } else {
                    eprintln!("Aura is hidden. Press Ctrl+Alt+Space to show it.");
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
