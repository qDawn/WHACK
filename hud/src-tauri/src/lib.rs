use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use tauri::{Emitter, Manager};

#[derive(Clone, serde::Serialize)]
struct SuggestionView {
    title: String,
    detail: String,
    reason: String,
    source: String,
    kind: String,
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

fn configured_scratchpad_path() -> Result<PathBuf, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.join("../..");
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

fn fit_full_screen(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };
    let size = monitor.size();
    let work = monitor.work_area();
    let _ = window.set_size(tauri::PhysicalSize::new(size.width, size.height));
    let _ = window.set_position(tauri::PhysicalPosition::new(
        work.position.x as i32,
        work.position.y as i32,
    ));
}

fn hide_window(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.hide();
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
                .unwrap_or("Open failed")
                .to_string();
            let _ = app.emit("hud-error", message);
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

#[tauri::command]
fn open_action(kind: String) -> Result<(), String> {
    match kind.as_str() {
        "open_godot" | "open_terminal" | "focus_discord" => {}
        _ => return Err("Unknown action".to_string()),
    }
    let line = format!("{{\"kind\":\"{kind}\"}}\n");
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

fn toggle_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => {
            fit_full_screen(&window);
            place_over_work_area(&window);
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_suggestion,
            read_scratchpad,
            write_scratchpad
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                fit_full_screen(&window);
        .invoke_handler(tauri::generate_handler![read_suggestion, open_action])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                place_over_work_area(&window);
            }
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
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                    }
                } else {
                    eprintln!("Aura is hidden. Press Ctrl+Alt+Space to show it.");
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
