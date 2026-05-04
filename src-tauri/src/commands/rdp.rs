use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

lazy_static::lazy_static! {
    static ref RDP_PROCS: Arc<Mutex<HashMap<String, tokio::process::Child>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpConnectParams {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub domain: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fullscreen: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RdpStatusEvent {
    session_id: String,
    status: String,
    message: Option<String>,
}

#[tauri::command]
pub async fn rdp_connect(app: AppHandle, params: RdpConnectParams) -> std::result::Result<(), String> {
    let session_id = params.session_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        let _ = app_clone.emit("rdp-status", RdpStatusEvent {
            session_id: session_id.clone(),
            status: "connecting".into(),
            message: None,
        });

        match launch_rdp_client(&params).await {
            Ok(mut child) => {
                let _ = app_clone.emit("rdp-status", RdpStatusEvent {
                    session_id: session_id.clone(),
                    status: "connected".into(),
                    message: None,
                });

                // Wait for process to exit
                let _ = child.wait().await;

                let _ = app_clone.emit("rdp-status", RdpStatusEvent {
                    session_id: session_id.clone(),
                    status: "disconnected".into(),
                    message: None,
                });
            }
            Err(e) => {
                let _ = app_clone.emit("rdp-status", RdpStatusEvent {
                    session_id: session_id.clone(),
                    status: "error".into(),
                    message: Some(e),
                });
            }
        }
    });

    Ok(())
}

async fn launch_rdp_client(params: &RdpConnectParams) -> std::result::Result<tokio::process::Child, String> {
    let host_port = format!("{}:{}", params.host, params.port);

    #[cfg(target_os = "windows")]
    {
        // Use built-in mstsc on Windows
        let mut cmd = Command::new("mstsc");
        cmd.arg(format!("/v:{}", host_port));
        if params.fullscreen.unwrap_or(false) {
            cmd.arg("/f");
        }
        if let Some(w) = params.width {
            if let Some(h) = params.height {
                cmd.arg(format!("/w:{}", w)).arg(format!("/h:{}", h));
            }
        }
        cmd.spawn().map_err(|e| format!("Failed to launch mstsc: {}", e))
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Use xfreerdp on Linux/Mac
        let mut cmd = Command::new("xfreerdp");
        cmd.arg(format!("/v:{}", host_port));
        cmd.arg(format!("/u:{}", params.username));

        if let Some(domain) = &params.domain {
            if !domain.is_empty() {
                cmd.arg(format!("/d:{}", domain));
            }
        }
        if let Some(pw) = &params.password {
            cmd.arg(format!("/p:{}", pw));
        }
        if params.fullscreen.unwrap_or(false) {
            cmd.arg("/f");
        } else {
            let w = params.width.unwrap_or(1280);
            let h = params.height.unwrap_or(800);
            cmd.arg(format!("/w:{}", w)).arg(format!("/h:{}", h));
        }
        cmd.arg("/cert:tofu"); // Trust on first use

        cmd.spawn().map_err(|e| format!("Failed to launch xfreerdp: {}", e))
    }
}

#[tauri::command]
pub async fn rdp_disconnect(session_id: String) -> std::result::Result<(), String> {
    // On Windows, mstsc manages its own window; we can't easily kill it cleanly.
    // For xfreerdp we can kill the process.
    #[cfg(not(target_os = "windows"))]
    {
        let mut procs = RDP_PROCS.lock().unwrap();
        if let Some(mut child) = procs.remove(&session_id) {
            let _ = child.kill().await;
        }
    }
    Ok(())
}
