use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use serde::{Deserialize, Serialize};

use crate::store::AuthType;

/// Shared map of session_id -> input sender
type SshSessions = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<SshInput>>>>;

lazy_static::lazy_static! {
    static ref SESSIONS: SshSessions = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug)]
enum SshInput {
    Data(String),
    Resize { cols: u16, rows: u16 },
    Disconnect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectParams {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub keepalive_interval: Option<u32>, // seconds; None = disabled
    pub connect_timeout: Option<u32>,    // seconds; None = no timeout
    pub initial_cols: Option<u16>,
    pub initial_rows: Option<u16>,
}

/// Emitted to frontend for terminal output
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshOutputEvent {
    session_id: String,
    data: String,
}

/// Emitted when connection status changes
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshStatusEvent {
    session_id: String,
    status: String, // "connected" | "disconnected" | "error"
    message: Option<String>,
}

#[tauri::command]
pub async fn ssh_connect(app: AppHandle, params: SshConnectParams) -> std::result::Result<(), String> {
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<SshInput>();

    {
        let mut sessions = SESSIONS.lock().unwrap();
        sessions.insert(params.session_id.clone(), input_tx);
    }

    let session_id = params.session_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        // Emit connecting status
        let _ = app_clone.emit("ssh-status", SshStatusEvent {
            session_id: session_id.clone(),
            status: "connecting".into(),
            message: None,
        });

        match run_ssh_session(&app_clone, &params, &mut input_rx).await {
            Ok(_) => {
                let _ = app_clone.emit("ssh-status", SshStatusEvent {
                    session_id: session_id.clone(),
                    status: "disconnected".into(),
                    message: None,
                });
            }
            Err(e) => {
                let _ = app_clone.emit("ssh-status", SshStatusEvent {
                    session_id: session_id.clone(),
                    status: "error".into(),
                    message: Some(e),
                });
            }
        }

        // Cleanup
        let mut sessions = SESSIONS.lock().unwrap();
        sessions.remove(&session_id);
    });

    Ok(())
}

async fn run_ssh_session(
    app: &AppHandle,
    params: &SshConnectParams,
    input_rx: &mut mpsc::UnboundedReceiver<SshInput>,
) -> std::result::Result<(), String> {
    use russh::*;
    use russh_keys::*;
    use std::sync::Arc;

    let keepalive = params.keepalive_interval
        .filter(|&s| s > 0)
        .map(|s| std::time::Duration::from_secs(s.into()));

    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        keepalive_interval: keepalive,
        keepalive_max: 3,
        ..<_>::default()
    });

    let session_id = params.session_id.clone();
    let app_emit = app.clone();

    let (close_tx, mut close_rx) = mpsc::unbounded_channel::<()>();

    struct ClientHandler {
        session_id: String,
        app: AppHandle,
        close_tx: mpsc::UnboundedSender<()>,
    }

    #[async_trait::async_trait]
    impl client::Handler for ClientHandler {
        type Error = russh::Error;

        async fn check_server_key(
            &mut self,
            _server_public_key: &key::PublicKey,
        ) -> std::result::Result<bool, Self::Error> {
            Ok(true)
        }

        async fn data(
            &mut self,
            _channel: ChannelId,
            data: &[u8],
            _session: &mut client::Session,
        ) -> std::result::Result<(), Self::Error> {
            let text = String::from_utf8_lossy(data).to_string();
            let _ = self.app.emit("ssh-output", SshOutputEvent {
                session_id: self.session_id.clone(),
                data: text,
            });
            Ok(())
        }

        async fn channel_eof(
            &mut self,
            _channel: ChannelId,
            _session: &mut client::Session,
        ) -> std::result::Result<(), Self::Error> {
            let _ = self.close_tx.send(());
            Ok(())
        }
    }

    let handler = ClientHandler {
        session_id: session_id.clone(),
        app: app_emit,
        close_tx,
    };

    let addr = format!("{}:{}", params.host, params.port);
    let connect_fut = client::connect(config, addr, handler);
    let mut session = if let Some(secs) = params.connect_timeout.filter(|&s| s > 0) {
        tokio::time::timeout(std::time::Duration::from_secs(secs.into()), connect_fut)
            .await
            .map_err(|_| format!("Connection timed out after {}s", secs))?
            .map_err(|e| format!("Connection failed: {}", e))?
    } else {
        connect_fut.await.map_err(|e| format!("Connection failed: {}", e))?
    };

    // Authenticate
    let authenticated = match &params.auth_type {
        AuthType::Password => {
            let pw = params.password.as_deref().unwrap_or("");
            session.authenticate_password(&params.username, pw)
                .await
                .map_err(|e| format!("Auth failed: {}", e))?
        }
        AuthType::PublicKey => {
            let key_path = params.private_key_path.as_deref()
                .ok_or("No private key path provided")?;
            let passphrase = params.private_key_passphrase.as_deref();
            let key_pair = load_secret_key(key_path, passphrase)
                .map_err(|e| format!("Key load failed: {}", e))?;
            session.authenticate_publickey(&params.username, Arc::new(key_pair))
                .await
                .map_err(|e| format!("Key auth failed: {}", e))?
        }
        AuthType::Agent => {
            return Err("SSH agent auth not yet implemented".into());
        }
    };

    if !authenticated {
        return Err("Authentication rejected by server".into());
    }

    // Open a PTY channel
    let channel = session.channel_open_session()
        .await
        .map_err(|e| format!("Channel open failed: {}", e))?;

    channel.request_pty(
        false,
        "xterm-256color",
        params.initial_cols.unwrap_or(80) as u32,
        params.initial_rows.unwrap_or(24) as u32,
        0, 0,
        &[],
    ).await.map_err(|e| format!("PTY request failed: {}", e))?;

    channel.request_shell(false)
        .await
        .map_err(|e| format!("Shell request failed: {}", e))?;

    // Emit connected
    let _ = app.emit("ssh-status", SshStatusEvent {
        session_id: session_id.clone(),
        status: "connected".into(),
        message: None,
    });

    // Process input from frontend, break on server EOF or explicit disconnect
    loop {
        tokio::select! {
            msg = input_rx.recv() => {
                match msg {
                    Some(SshInput::Data(data)) => {
                        channel.data(data.as_bytes())
                            .await
                            .map_err(|e| format!("Send failed: {}", e))?;
                    }
                    Some(SshInput::Resize { cols, rows }) => {
                        channel.window_change(cols as u32, rows as u32, 0, 0)
                            .await
                            .map_err(|e| format!("Resize failed: {}", e))?;
                    }
                    Some(SshInput::Disconnect) | None => {
                        let _ = channel.eof().await;
                        break;
                    }
                }
            }
            _ = close_rx.recv() => {
                break;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn ssh_send_input(session_id: String, data: String) -> std::result::Result<(), String> {
    let sessions = SESSIONS.lock().unwrap();
    if let Some(tx) = sessions.get(&session_id) {
        tx.send(SshInput::Data(data)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_resize(session_id: String, cols: u16, rows: u16) -> std::result::Result<(), String> {
    let sessions = SESSIONS.lock().unwrap();
    if let Some(tx) = sessions.get(&session_id) {
        tx.send(SshInput::Resize { cols, rows }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_disconnect(session_id: String) -> std::result::Result<(), String> {
    let sessions = SESSIONS.lock().unwrap();
    if let Some(tx) = sessions.get(&session_id) {
        let _ = tx.send(SshInput::Disconnect);
    }
    Ok(())
}
