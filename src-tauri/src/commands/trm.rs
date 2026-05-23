use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use serde::{Deserialize, Serialize};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};

type TrmSessions = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<TrmInput>>>>;

lazy_static::lazy_static! {
    static ref SESSIONS: TrmSessions = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug)]
enum TrmInput {
    Data(String),
    Resize { cols: u16, rows: u16 },
    Disconnect,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrmConnectParams {
    pub session_id: String,
    pub working_directory: Option<String>,
    pub shell_path: Option<String>,
    pub initial_cols: Option<u16>,
    pub initial_rows: Option<u16>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrmOutputEvent {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrmStatusEvent {
    session_id: String,
    status: String,
    message: Option<String>,
}

#[tauri::command]
pub async fn trm_connect(app: AppHandle, params: TrmConnectParams) -> std::result::Result<(), String> {
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<TrmInput>();

    {
        let mut sessions = SESSIONS.lock().unwrap();
        sessions.insert(params.session_id.clone(), input_tx);
    }

    let session_id = params.session_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        let _ = app_clone.emit("trm-status", TrmStatusEvent {
            session_id: session_id.clone(),
            status: "connecting".into(),
            message: None,
        });

        match run_trm_session(&app_clone, &params, &mut input_rx).await {
            Ok(_) => {
                let _ = app_clone.emit("trm-status", TrmStatusEvent {
                    session_id: session_id.clone(),
                    status: "disconnected".into(),
                    message: None,
                });
            }
            Err(e) => {
                let _ = app_clone.emit("trm-status", TrmStatusEvent {
                    session_id: session_id.clone(),
                    status: "error".into(),
                    message: Some(e),
                });
            }
        }

        let mut sessions = SESSIONS.lock().unwrap();
        sessions.remove(&session_id);
    });

    Ok(())
}

async fn run_trm_session(
    app: &AppHandle,
    params: &TrmConnectParams,
    input_rx: &mut mpsc::UnboundedReceiver<TrmInput>,
) -> std::result::Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system.openpty(PtySize {
        rows: params.initial_rows.unwrap_or(24),
        cols: params.initial_cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| format!("PTY open failed: {e}"))?;

    let shell = if let Some(ref s) = params.shell_path {
        s.clone()
    } else {
        #[cfg(windows)]
        { "powershell.exe".to_string() }
        #[cfg(not(windows))]
        { std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()) }
    };

    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Some(ref dir) = params.working_directory {
        cmd.cwd(dir);
    }

    let portable_pty::PtyPair { master, slave } = pair;
    let mut child = slave.spawn_command(cmd).map_err(|e| format!("Shell spawn failed: {e}"))?;
    drop(slave);

    let mut reader = master.try_clone_reader().map_err(|e| format!("PTY reader failed: {e}"))?;
    let mut writer = master.take_writer().map_err(|e| format!("PTY writer failed: {e}"))?;

    let session_id = params.session_id.clone();
    let app_emit = app.clone();

    // Blocking thread to read PTY output
    let (output_tx, mut output_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if output_tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let _ = app.emit("trm-status", TrmStatusEvent {
        session_id: session_id.clone(),
        status: "connected".into(),
        message: None,
    });

    loop {
        tokio::select! {
            result = output_rx.recv() => {
                match result {
                    Some(data) => {
                        let text = String::from_utf8_lossy(&data).to_string();
                        let _ = app_emit.emit("trm-output", TrmOutputEvent {
                            session_id: session_id.clone(),
                            data: text,
                        });
                    }
                    None => break, // shell exited, reader thread closed
                }
            }
            msg = input_rx.recv() => {
                match msg {
                    Some(TrmInput::Data(data)) => {
                        let _ = writer.write_all(data.as_bytes());
                    }
                    Some(TrmInput::Resize { cols, rows }) => {
                        let _ = master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                    }
                    Some(TrmInput::Disconnect) | None => break,
                }
            }
        }
    }

    let _ = child.kill();
    Ok(())
}

#[tauri::command]
pub async fn trm_send_input(session_id: String, data: String) -> std::result::Result<(), String> {
    let sessions = SESSIONS.lock().unwrap();
    if let Some(tx) = sessions.get(&session_id) {
        tx.send(TrmInput::Data(data)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn trm_resize(session_id: String, cols: u16, rows: u16) -> std::result::Result<(), String> {
    let sessions = SESSIONS.lock().unwrap();
    if let Some(tx) = sessions.get(&session_id) {
        tx.send(TrmInput::Resize { cols, rows }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn trm_disconnect(session_id: String) -> std::result::Result<(), String> {
    let sessions = SESSIONS.lock().unwrap();
    if let Some(tx) = sessions.get(&session_id) {
        let _ = tx.send(TrmInput::Disconnect);
    }
    Ok(())
}
