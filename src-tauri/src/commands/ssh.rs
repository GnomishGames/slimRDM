use std::borrow::Cow;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use serde::{Deserialize, Serialize};

use sha2::{Digest, Sha256};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;

use crate::store::AuthType;
use crate::commands::tunnel_utils::{JumpHostParams, open_jump_channel};

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
    pub credential_ref: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub keepalive_interval: Option<u32>, // seconds; None = disabled
    pub connect_timeout: Option<u32>,    // seconds; None = no timeout
    pub initial_cols: Option<u16>,
    pub initial_rows: Option<u16>,
    pub startup_commands: Option<String>,
    pub jump_host_params: Option<JumpHostParams>,
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

    // Extend the default preferred algorithms to include legacy options required by
    // Cisco switches (CBS350 etc.) which only offer diffie-hellman-group14-sha1,
    // aes128-cbc ciphers, and ssh-rsa host keys. Modern servers still negotiate
    // the strongest mutually-supported algorithm, so adding these is safe.
    let preferred = Preferred {
        kex: Cow::Owned(vec![
            kex::CURVE25519,
            kex::CURVE25519_PRE_RFC_8731,
            kex::DH_G16_SHA512,
            kex::DH_G14_SHA256,
            kex::EXTENSION_SUPPORT_AS_CLIENT,
            kex::EXTENSION_SUPPORT_AS_SERVER,
            kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT,
            kex::EXTENSION_OPENSSH_STRICT_KEX_AS_SERVER,
            kex::DH_G14_SHA1,
            kex::DH_G1_SHA1,
        ]),
        key: Cow::Owned(vec![
            key::ED25519,
            key::ECDSA_SHA2_NISTP256,
            key::ECDSA_SHA2_NISTP521,
            key::RSA_SHA2_256,
            key::RSA_SHA2_512,
            key::SSH_RSA,
        ]),
        cipher: Cow::Owned(vec![
            cipher::CHACHA20_POLY1305,
            cipher::AES_256_GCM,
            cipher::AES_256_CTR,
            cipher::AES_192_CTR,
            cipher::AES_128_CTR,
            cipher::AES_256_CBC,
            cipher::AES_192_CBC,
            cipher::AES_128_CBC,
        ]),
        ..Preferred::DEFAULT
    };

    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(3600)),
        keepalive_interval: keepalive,
        keepalive_max: 3,
        preferred,
        ..<_>::default()
    });

    let session_id = params.session_id.clone();
    let app_emit = app.clone();

    let (close_tx, mut close_rx) = mpsc::unbounded_channel::<()>();

    struct ClientHandler {
        host: String,
        session_id: String,
        app: AppHandle,
        close_tx: mpsc::UnboundedSender<()>,
    }

    #[async_trait::async_trait]
    impl client::Handler for ClientHandler {
        type Error = russh::Error;

        async fn check_server_key(
            &mut self,
            server_public_key: &key::PublicKey,
        ) -> std::result::Result<bool, Self::Error> {
            let fp = BASE64.encode(Sha256::digest(format!("{server_public_key:?}").as_bytes()));
            match crate::commands::known_hosts::check_or_store(&self.host, &fp) {
                Ok(trusted) => Ok(trusted),
                Err(msg) => {
                    let _ = self.app.emit("ssh-status", SshStatusEvent {
                        session_id: self.session_id.clone(),
                        status: "error".into(),
                        message: Some(msg),
                    });
                    Ok(false)
                }
            }
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
        host: params.host.clone(),
        session_id: session_id.clone(),
        app: app_emit,
        close_tx,
    };

    ssh_log(&format!(
        "Connecting to {}:{} user={} auth={:?} timeout={:?}s",
        params.host, params.port, params.username, params.auth_type, params.connect_timeout
    ));

    let connect_result = if let Some(ref jump) = params.jump_host_params {
        let stream = open_jump_channel(jump, &params.host, params.port)
            .await
            .map_err(|e| format!("Jump host error: {e}"))?;
        if let Some(secs) = params.connect_timeout.filter(|&s| s > 0) {
            tokio::time::timeout(
                std::time::Duration::from_secs(secs.into()),
                client::connect_stream(config, stream, handler),
            )
            .await
            .map_err(|_| format!("Connection timed out after {}s", secs))?
            .map_err(|e| format!("Connection failed: {e}"))
        } else {
            client::connect_stream(config, stream, handler)
                .await
                .map_err(|e| format!("Connection failed: {e}"))
        }
    } else {
        let addr = format!("{}:{}", params.host, params.port);
        if let Some(secs) = params.connect_timeout.filter(|&s| s > 0) {
            tokio::time::timeout(
                std::time::Duration::from_secs(secs.into()),
                client::connect(config, addr, handler),
            )
            .await
            .map_err(|_| format!("Connection timed out after {}s", secs))?
            .map_err(|e| format!("Connection failed: {e}"))
        } else {
            client::connect(config, addr, handler)
                .await
                .map_err(|e| format!("Connection failed: {e}"))
        }
    };

    if let Err(ref e) = connect_result {
        ssh_log(&format!("Connect error for {}:{} — {}", params.host, params.port, e));
    }
    let mut session = connect_result?;

    // Fetch stored password upfront — needed for both auth and startup command tokens.
    let stored_pw = match &params.auth_type {
        AuthType::Password => params.credential_ref.as_deref()
            .and_then(crate::commands::credentials::get_credential_sync)
            .unwrap_or_default(),
        _ => String::new(),
    };

    // Authenticate
    let authenticated = match &params.auth_type {
        AuthType::Password => {
            let pw = &stored_pw;

            ssh_log(&format!(
                "credential_ref={:?} found={} pw_len={}",
                params.credential_ref.as_deref().unwrap_or("(none)"),
                !pw.is_empty(),
                pw.len()
            ));

            // Step 1: try "none" auth. OpenSSH always does this first; some devices
            // (e.g. switches with no local password configured) accept it outright.
            let none_result = session
                .authenticate_none(&params.username)
                .await
                .map_err(|e| format!("Auth failed: {}", e))?;
            if none_result {
                ssh_log("Auth succeeded via none");
                true
            } else {
                // Step 2: password auth. For Ubuntu+PAM servers that respond with
                // INFO_REQUEST instead of SUCCESS/FAILURE, russh responds to the
                // prompt inline using the stored password (see vendor/russh patch).
                let pw_result = session
                    .authenticate_password(&params.username, pw.as_str())
                    .await
                    .map_err(|e| format!("Auth failed: {}", e))?;

                if pw_result {
                    true
                } else {
                    // Step 3: keyboard-interactive fallback for servers that only
                    // advertise keyboard-interactive (not password) method.
                    let mut ki = session
                        .authenticate_keyboard_interactive_start(&params.username, None)
                        .await
                        .map_err(|e| format!("Auth failed: {}", e))?;
                    loop {
                        match ki {
                            client::KeyboardInteractiveAuthResponse::Success => break true,
                            client::KeyboardInteractiveAuthResponse::Failure => break false,
                            client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                                let responses: Vec<String> = prompts
                                    .iter()
                                    .enumerate()
                                    .map(|(i, _)| if i == 0 { pw.to_string() } else { String::new() })
                                    .collect();
                                ki = session
                                    .authenticate_keyboard_interactive_respond(responses)
                                    .await
                                    .map_err(|e| format!("Auth failed: {}", e))?;
                            }
                        }
                    }
                }
            }
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
        ssh_log(&format!("Auth rejected for {}:{} user={}", params.host, params.port, params.username));
        return Err("Authentication rejected by server".into());
    }

    ssh_log(&format!("Authenticated OK for {}:{} user={}", params.host, params.port, params.username));

    // Open a PTY channel
    let mut channel = session.channel_open_session()
        .await
        .map_err(|e| format!("Channel open failed: {}", e))?;

    channel.request_pty(
        true,
        "xterm-256color",
        params.initial_cols.unwrap_or(80) as u32,
        params.initial_rows.unwrap_or(24) as u32,
        0, 0,
        &[],
    ).await.map_err(|e| format!("PTY request failed: {}", e))?;

    loop {
        match channel.wait().await {
            Some(ChannelMsg::Success) => break,
            Some(ChannelMsg::Failure) => return Err("Server refused PTY allocation".into()),
            None => return Err("Channel closed during PTY setup".into()),
            _ => {}
        }
    }

    channel.request_shell(true)
        .await
        .map_err(|e| format!("Shell request failed: {}", e))?;

    loop {
        match channel.wait().await {
            Some(ChannelMsg::Success) => break,
            Some(ChannelMsg::Failure) => return Err("Server refused shell request".into()),
            None => return Err("Channel closed during shell setup".into()),
            _ => {}
        }
    }

    // Emit connected
    let _ = app.emit("ssh-status", SshStatusEvent {
        session_id: session_id.clone(),
        status: "connected".into(),
        message: None,
    });

    // Send startup commands after a brief delay to let the shell initialize.
    // Use \r alone (not \r\n) — that is the exact byte xterm.js sends for Enter,
    // and it is what the remote PTY line discipline expects to trigger execution.
    // Supports {username} and {password} tokens, replaced with the stored credentials.
    // Useful for devices that require a second shell-level login after SSH auth (e.g.
    // switches that accept "none" SSH auth then prompt for credentials in the CLI).
    if let Some(ref cmds) = params.startup_commands {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        for cmd in cmds.lines() {
            let cmd = cmd.trim()
                .replace("{username}", &params.username)
                .replace("{password}", &stored_pw);
            if !cmd.is_empty() {
                channel.data(format!("{}\r", cmd).as_bytes())
                    .await
                    .map_err(|e| format!("Startup command failed: {}", e))?;
                // Small gap between lines so the remote shell can process each entry.
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
    }

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

fn ssh_log(msg: &str) {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let path = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let log = format!("{path}/.local/share/slimrdm/ssh.log");
    // Rotate at 1 MB so the log doesn't grow unbounded.
    if std::fs::metadata(&log).map(|m| m.len()).unwrap_or(0) > 1_000_000 {
        let _ = std::fs::rename(&log, format!("{log}.1"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log) {
        let _ = writeln!(f, "[{ts}] {msg}");
    }
    log::debug!("{msg}");
}
