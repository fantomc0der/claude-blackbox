use std::{
    net::{SocketAddr, TcpListener, TcpStream},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

mod desktop;
#[cfg(windows)]
mod job;

struct Sidecar(Mutex<Option<CommandChild>>);

#[cfg(windows)]
struct SidecarJob(#[allow(dead_code)] job::KillOnCloseJob);

/// Makes Windows terminate the sidecar when this process ends for any reason,
/// including the forced kills used by the installer and Task Manager that never
/// reach `stop_sidecar`.
#[cfg(windows)]
fn tie_sidecar_to_process(app: &tauri::App, pid: u32) {
    match job::KillOnCloseJob::new().and_then(|job| job.assign(pid).map(|()| job)) {
        Ok(job) => {
            app.manage(SidecarJob(job));
        }
        Err(error) => eprintln!(
            "could not tie the sidecar to this process; it may outlive a forced exit: {error}"
        ),
    }
}

fn reserve_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

fn wait_for_server(port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("the claude-blackbox server did not start within 120 seconds".into())
}

pub(crate) fn stop_sidecar(app: &tauri::AppHandle) {
    if let Some(child) = app
        .state::<Sidecar>()
        .0
        .lock()
        .expect("sidecar lock poisoned")
        .take()
    {
        let _ = child.kill();
    }
}

pub(crate) fn quit(app: &tauri::AppHandle) {
    desktop::mark_quitting(app);
    stop_sidecar(app);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let port = reserve_port()?;
            let port_argument = port.to_string();
            let (mut events, child) = app
                .shell()
                .sidecar("claude-blackbox-server")?
                .args(["--port", port_argument.as_str(), "--exit-with-parent"])
                .spawn()?;
            #[cfg(windows)]
            tie_sidecar_to_process(app, child.pid());
            app.manage(Sidecar(Mutex::new(Some(child))));

            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                            println!("{}", String::from_utf8_lossy(&line));
                        }
                        tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                            eprintln!("{}", String::from_utf8_lossy(&line));
                        }
                        _ => {}
                    }
                }
            });

            wait_for_server(port)?;
            let url = format!("http://127.0.0.1:{port}");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("claude-blackbox")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 640.0)
                .on_navigation(move |destination| {
                    destination.scheme() == "http"
                        && destination.host_str() == Some("127.0.0.1")
                        && destination.port_or_known_default() == Some(port)
                })
                .build()?;
            desktop::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if window
                        .app_handle()
                        .state::<desktop::DesktopState>()
                        .should_close_to_tray()
                    {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        quit(window.app_handle());
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building claude-blackbox")
        .run(|app, event| match event {
            RunEvent::Exit | RunEvent::ExitRequested { .. } => stop_sidecar(app),
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => desktop::show_main_window(app),
            _ => {}
        });
}
