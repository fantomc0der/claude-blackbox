use std::{
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent, TerminatedPayload},
    ShellExt,
};

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

/// Waits for the sidecar to accept connections. Gives up as soon as the sidecar
/// exits so a server that fails to start is reported immediately instead of
/// after the full timeout with no window on screen.
fn wait_for_server(port: u16, exited: &AtomicBool) -> Result<(), Box<dyn std::error::Error>> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
            return Ok(());
        }
        if exited.load(Ordering::SeqCst) {
            return Err("the claude-blackbox server exited before it started listening".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("the claude-blackbox server did not start within 120 seconds".into())
}

fn show_error(message: &str) {
    let _ = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("claude-blackbox")
        .set_description(message)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

/// Takes the sidecar out of the managed state. `stop_sidecar` does this before
/// killing the child, so a child that is still held here exited on its own.
fn take_sidecar(app: &AppHandle) -> Option<CommandChild> {
    app.state::<Sidecar>()
        .0
        .lock()
        .expect("sidecar lock poisoned")
        .take()
}

pub(crate) fn stop_sidecar(app: &AppHandle) {
    if let Some(child) = take_sidecar(app) {
        let _ = child.kill();
    }
}

pub(crate) fn quit(app: &AppHandle) {
    desktop::mark_quitting(app);
    stop_sidecar(app);
    app.exit(0);
}

/// Handles the sidecar ending on its own. A wrapper whose server is gone would
/// otherwise sit in the tray showing a dead page and, being the single running
/// instance, stop every later launch from opening a working one.
fn sidecar_exited(app: &AppHandle, payload: TerminatedPayload, started: bool) {
    if take_sidecar(app).is_none() {
        return;
    }
    let status = match (payload.code, payload.signal) {
        (Some(code), _) => format!("exit code {code}"),
        (None, Some(signal)) => format!("signal {signal}"),
        (None, None) => "an unknown status".to_owned(),
    };
    eprintln!("the claude-blackbox server stopped unexpectedly with {status}");
    if !started {
        // Startup is still waiting on the server and reports the failure itself.
        return;
    }
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        show_error(&format!(
            "The claude-blackbox server stopped unexpectedly with {status}.\n\nThe app will close; launch it again to restart the server."
        ));
        app.exit(1);
    });
}

fn start(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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

    let exited = Arc::new(AtomicBool::new(false));
    let started = Arc::new(AtomicBool::new(false));
    let handle = app.handle().clone();
    let exited_flag = exited.clone();
    let started_flag = started.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("{}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("{}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    exited_flag.store(true, Ordering::SeqCst);
                    sidecar_exited(&handle, payload, started_flag.load(Ordering::SeqCst));
                }
                _ => {}
            }
        }
    });

    wait_for_server(port, &exited)?;
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
    started.store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Registered first so a second launch hands off to the running instance
        // instead of starting another wrapper and sidecar pair.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Err(error) = start(app) {
                eprintln!("claude-blackbox could not start: {error}");
                show_error(&format!("claude-blackbox could not start.\n\n{error}"));
                return Err(error);
            }
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
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(error) => {
            eprintln!("error while building claude-blackbox: {error}");
            std::process::exit(1);
        }
    };
    app.run(|app, event| match event {
        RunEvent::Exit | RunEvent::ExitRequested { .. } => stop_sidecar(app),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => desktop::show_main_window(app),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::{reserve_port, wait_for_server};
    use std::{
        net::TcpListener,
        sync::atomic::AtomicBool,
        time::{Duration, Instant},
    };

    #[test]
    fn startup_wait_succeeds_once_the_server_listens() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(wait_for_server(port, &AtomicBool::new(false)).is_ok());
    }

    #[test]
    fn startup_wait_stops_as_soon_as_the_sidecar_exits() {
        let port = reserve_port().unwrap();
        let started = Instant::now();
        let error = wait_for_server(port, &AtomicBool::new(true)).unwrap_err();
        assert!(error
            .to_string()
            .contains("exited before it started listening"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
