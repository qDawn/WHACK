use std::io::{BufRead, BufReader};
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

fn text_field(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string()
}

fn suggestion_from_line(line: &str) -> Option<SuggestionView> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let Some(suggestion) = value.pointer("/payload/suggestion") else {
        return Some(SuggestionView {
            title: "No suggestion for this context".to_string(),
            detail: String::new(),
            reason: String::new(),
            source: "none".to_string(),
            kind: "none".to_string(),
        });
    };
    if suggestion.is_null() {
        return Some(SuggestionView {
            title: "No suggestion for this context".to_string(),
            detail: String::new(),
            reason: String::new(),
            source: "none".to_string(),
            kind: "none".to_string(),
        });
    }
    Some(SuggestionView {
        title: text_field(suggestion, "title"),
        detail: text_field(suggestion, "detail"),
        reason: text_field(suggestion, "reason"),
        source: text_field(suggestion, "source"),
        kind: text_field(suggestion, "kind"),
    })
}

fn listen_for_snapshots(app: tauri::AppHandle) {
    loop {
        match std::fs::File::open(r"\\.\pipe\aura") {
            Ok(file) => {
                for line in BufReader::new(file).lines() {
                    let Ok(line) = line else { break };
                    let Some(suggestion) = suggestion_from_line(&line) else {
                        continue;
                    };
                    let _ = app.emit("suggestion", suggestion);
                }
            }
            Err(_) => thread::sleep(Duration::from_millis(400)),
        }
    }
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
