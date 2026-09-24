use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const MENU_OPEN: &str = "tray-open";
const MENU_UPDATE: &str = "tray-update";
const MENU_RELEASES: &str = "tray-releases";
const MENU_CLOSE_TO_TRAY: &str = "tray-close-to-tray";
const MENU_QUIT: &str = "tray-quit";
const MENU_UPDATE_LABEL: &str = "Check for updates…";
const RELEASES_URL: &str = "https://github.com/fantomc0der/claude-blackbox/releases/latest";

#[derive(Debug, Deserialize, Serialize)]
#[serde(default)]
struct DesktopPreferences {
    close_to_tray: bool,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            close_to_tray: true,
        }
    }
}

pub struct DesktopState {
    close_to_tray: AtomicBool,
    quitting: AtomicBool,
    preferences_path: PathBuf,
}

impl DesktopState {
    pub fn should_close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed) && !self.quitting.load(Ordering::Relaxed)
    }

    pub fn mark_quitting(&self) {
        self.quitting.store(true, Ordering::Relaxed);
    }

    fn disable_close_to_tray(&self) {
        self.close_to_tray.store(false, Ordering::Relaxed);
    }

    fn set_close_to_tray(&self, close_to_tray: bool) -> std::io::Result<()> {
        self.close_to_tray.store(close_to_tray, Ordering::Relaxed);
        save_preferences(
            &self.preferences_path,
            &DesktopPreferences { close_to_tray },
        )
    }
}

fn load_preferences(path: &Path) -> DesktopPreferences {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn save_preferences(path: &Path, preferences: &DesktopPreferences) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(preferences)?)
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn mark_quitting(app: &AppHandle) {
    app.state::<DesktopState>().mark_quitting();
}

fn show_temporary_update_status(update_item: MenuItem<tauri::Wry>, status: impl AsRef<str>) {
    let _ = update_item.set_text(status);
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(5));
        let _ = update_item.set_text(MENU_UPDATE_LABEL);
        let _ = update_item.set_enabled(true);
    });
}

fn check_for_updates(app: AppHandle, update_item: MenuItem<tauri::Wry>) {
    let _ = update_item.set_enabled(false);
    let _ = update_item.set_text("Checking for updates…");

    tauri::async_runtime::spawn(async move {
        let result = async {
            let before_exit_app = app.clone();
            let updater = app
                .updater_builder()
                .on_before_exit(move || {
                    crate::stop_sidecar(&before_exit_app);
                    before_exit_app.cleanup_before_exit();
                })
                .build()?;
            let Some(update) = updater.check().await? else {
                show_temporary_update_status(
                    update_item.clone(),
                    format!("Up to date · v{}", app.package_info().version),
                );
                return Ok::<(), tauri_plugin_updater::Error>(());
            };

            let version = update.version.clone();
            let _ = update_item.set_text(format!("Downloading v{version}…"));
            let progress_item = update_item.clone();
            let mut downloaded = 0_u64;
            let mut last_percentage = 0_u64;

            update
                .download_and_install(
                    move |chunk_length, content_length| {
                        downloaded += chunk_length as u64;
                        if let Some(content_length) = content_length {
                            let percentage = downloaded.saturating_mul(100) / content_length.max(1);
                            if percentage >= last_percentage + 10 {
                                last_percentage = percentage;
                                let _ = progress_item
                                    .set_text(format!("Downloading v{version}… {percentage}%"));
                            }
                        }
                    },
                    || {},
                )
                .await?;

            let _ = update_item.set_text("Update installed · restarting…");
            crate::stop_sidecar(&app);
            app.restart();
        }
        .await;

        if let Err(error) = result {
            eprintln!("update failed: {error}");
            show_temporary_update_status(update_item, "Update failed · try again");
        }
    });
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let preferences_path = app.path().app_config_dir()?.join("desktop.json");
    let preferences = load_preferences(&preferences_path);
    let close_to_tray = preferences.close_to_tray;
    app.manage(DesktopState {
        close_to_tray: AtomicBool::new(close_to_tray),
        quitting: AtomicBool::new(false),
        preferences_path,
    });

    if let Err(error) = setup_tray(app, close_to_tray) {
        app.state::<DesktopState>().disable_close_to_tray();
        eprintln!("system tray unavailable; window close will exit the app: {error}");
    }

    Ok(())
}

fn setup_tray(app: &mut App, close_to_tray: bool) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, MENU_OPEN, "Open claude-blackbox", true, None::<&str>)?;
    let update_item = MenuItem::with_id(app, MENU_UPDATE, MENU_UPDATE_LABEL, true, None::<&str>)?;
    let releases_item = MenuItem::with_id(
        app,
        MENU_RELEASES,
        "Open GitHub releases",
        true,
        None::<&str>,
    )?;
    let close_to_tray_item = CheckMenuItem::with_id(
        app,
        MENU_CLOSE_TO_TRAY,
        "Keep running when window is closed",
        true,
        close_to_tray,
        None::<&str>,
    )?;
    let settings_menu = Submenu::with_items(app, "Settings", true, &[&close_to_tray_item])?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT, "Quit claude-blackbox", true, None::<&str>)?;

    let first_separator = PredefinedMenuItem::separator(app)?;
    let second_separator = PredefinedMenuItem::separator(app)?;
    let third_separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &first_separator,
            &update_item,
            &releases_item,
            &second_separator,
            &settings_menu,
            &third_separator,
            &quit_item,
        ],
    )?;

    let update_item_for_menu = update_item.clone();
    let close_to_tray_item_for_menu = close_to_tray_item.clone();
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("claude-blackbox · session flight recorder")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            MENU_OPEN => show_main_window(app),
            MENU_UPDATE => check_for_updates(app.clone(), update_item_for_menu.clone()),
            MENU_RELEASES => {
                if let Err(error) = app.opener().open_url(RELEASES_URL, None::<&str>) {
                    eprintln!("failed to open release page: {error}");
                }
            }
            MENU_CLOSE_TO_TRAY => match close_to_tray_item_for_menu.is_checked() {
                Ok(close_to_tray) => {
                    if let Err(error) = app.state::<DesktopState>().set_close_to_tray(close_to_tray)
                    {
                        eprintln!("failed to save desktop preferences: {error}");
                    }
                }
                Err(error) => eprintln!("failed to read close-to-tray preference: {error}"),
            },
            MENU_QUIT => crate::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::DesktopPreferences;
    use serde_json::Value;

    #[test]
    fn close_to_tray_is_enabled_by_default() {
        assert!(DesktopPreferences::default().close_to_tray);
    }

    #[test]
    fn missing_fields_use_safe_defaults() {
        let preferences: DesktopPreferences = serde_json::from_str("{}").unwrap();
        assert!(preferences.close_to_tray);
    }

    #[test]
    fn updater_configuration_stays_wired() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config.pointer("/bundle/createUpdaterArtifacts"),
            Some(&Value::Bool(true))
        );
        assert!(config
            .pointer("/plugins/updater/pubkey")
            .and_then(Value::as_str)
            .is_some_and(|pubkey| !pubkey.is_empty()));
        assert_eq!(
            config
                .pointer("/plugins/updater/endpoints/0")
                .and_then(Value::as_str),
            Some("https://github.com/fantomc0der/claude-blackbox/releases/latest/download/latest.json")
        );
    }

    #[test]
    fn installer_hooks_stop_the_sidecar() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config
                .pointer("/bundle/windows/nsis/installerHooks")
                .and_then(Value::as_str),
            Some("./windows/hooks.nsh")
        );
        let hooks = include_str!("../windows/hooks.nsh");
        assert!(hooks.contains("!macro NSIS_HOOK_PREINSTALL"));
        assert!(hooks.contains("!macro NSIS_HOOK_PREUNINSTALL"));
        assert!(hooks.contains("KillProcess"));
        assert!(hooks.contains("claude-blackbox-server.exe"));
    }
}
