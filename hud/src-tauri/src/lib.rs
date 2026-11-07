use std::path::PathBuf;

use tauri::Manager;

#[derive(serde::Serialize)]
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

fn place_top_right(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let work = monitor.work_area();
    let margin = (16.0 * monitor.scale_factor()) as i32;
    let x = work.position.x + work.size.width as i32 - size.width as i32 - margin;
    let y = work.position.y + margin;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
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
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_suggestion])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                place_top_right(&window);
            }

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
