use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use serde::{Deserialize, Serialize};

use crate::commands::tunnel_utils::JumpHostParams;
use crate::commands::connections::{load_store, save_store};
use crate::store::{TunnelConfig, NewTunnelConfig, UpdateTunnelConfig, new_id, now_ts};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TunnelStatus {
    Connecting,
    Active,
    Error,
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInstance {
    pub id: String,
    pub name: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: TunnelStatus,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTunnelParams {
    pub id: String,
    pub name: String,
    pub jump_host_params: JumpHostParams,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TunnelStatusEvent {
    id: String,
    status: TunnelStatus,
    local_port: Option<u16>,
    error: Option<String>,
}

type TunnelRegistry = Arc<Mutex<HashMap<String, TunnelInstance>>>;
type TunnelStops = Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>;

lazy_static::lazy_static! {
    static ref TUNNELS: TunnelRegistry = Arc::new(Mutex::new(HashMap::new()));
    static ref TUNNEL_STOPS: TunnelStops = Arc::new(Mutex::new(HashMap::new()));
}

#[tauri::command]
pub async fn open_tunnel(app: AppHandle, params: OpenTunnelParams) -> Result<(), String> {
    let id = params.id.clone();

    {
        let mut tunnels = TUNNELS.lock().unwrap();
        tunnels.insert(id.clone(), TunnelInstance {
            id: id.clone(),
            name: params.name.clone(),
            local_port: params.local_port,
            remote_host: params.remote_host.clone(),
            remote_port: params.remote_port,
            status: TunnelStatus::Connecting,
            error: None,
        });
    }

    let _ = app.emit("tunnel-status", TunnelStatusEvent {
        id: id.clone(),
        status: TunnelStatus::Connecting,
        local_port: None,
        error: None,
    });

    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    TUNNEL_STOPS.lock().unwrap().insert(id.clone(), stop_tx);

    let app_clone = app.clone();
    tokio::spawn(async move {
        match run_tunnel_listener(&app_clone, &params, stop_rx).await {
            Ok(_) => {
                TUNNELS.lock().unwrap().remove(&id);
                let _ = app_clone.emit("tunnel-status", TunnelStatusEvent {
                    id: id.clone(),
                    status: TunnelStatus::Closed,
                    local_port: None,
                    error: None,
                });
            }
            Err(e) => {
                TUNNELS.lock().unwrap().remove(&id);
                let _ = app_clone.emit("tunnel-status", TunnelStatusEvent {
                    id: id.clone(),
                    status: TunnelStatus::Error,
                    local_port: None,
                    error: Some(e),
                });
            }
        }
        TUNNEL_STOPS.lock().unwrap().remove(&id);
    });

    Ok(())
}

async fn run_tunnel_listener(
    app: &AppHandle,
    params: &OpenTunnelParams,
    mut stop_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    let bind_addr = format!("127.0.0.1:{}", params.local_port);
    let listener = TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| format!("Failed to bind on {bind_addr}: {e}"))?;

    let local_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {e}"))?
        .port();

    {
        let mut tunnels = TUNNELS.lock().unwrap();
        if let Some(t) = tunnels.get_mut(&params.id) {
            t.local_port = local_port;
            t.status = TunnelStatus::Active;
        }
    }

    let _ = app.emit("tunnel-status", TunnelStatusEvent {
        id: params.id.clone(),
        status: TunnelStatus::Active,
        local_port: Some(local_port),
        error: None,
    });

    let jump = Arc::new(params.jump_host_params.clone());
    let remote_host = Arc::new(params.remote_host.clone());
    let remote_port = params.remote_port;

    loop {
        tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((mut tcp_stream, _)) => {
                        let jump = Arc::clone(&jump);
                        let host = Arc::clone(&remote_host);
                        tokio::spawn(async move {
                            match crate::commands::tunnel_utils::open_jump_channel(&jump, &host, remote_port).await {
                                Ok(mut jump_stream) => {
                                    let _ = tokio::io::copy_bidirectional(&mut tcp_stream, &mut jump_stream).await;
                                }
                                Err(e) => {
                                    eprintln!("[tunnel] Proxied connection failed: {e}");
                                }
                            }
                        });
                    }
                    Err(e) => return Err(format!("Listener accept failed: {e}")),
                }
            }
            _ = &mut stop_rx => break,
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn list_tunnels() -> Result<Vec<TunnelInstance>, String> {
    let tunnels = TUNNELS.lock().unwrap();
    Ok(tunnels.values().cloned().collect())
}

#[tauri::command]
pub async fn close_tunnel(id: String) -> Result<(), String> {
    if let Some(tx) = TUNNEL_STOPS.lock().unwrap().remove(&id) {
        let _ = tx.send(());
    }
    Ok(())
}

// ── Persistent config CRUD ─────────────────────────────

#[tauri::command]
pub async fn list_tunnel_configs(app: tauri::AppHandle) -> Result<Vec<TunnelConfig>, String> {
    load_store(&app)
        .map(|s| s.tunnel_configs)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_tunnel_config(
    app: tauri::AppHandle,
    config: NewTunnelConfig,
) -> Result<TunnelConfig, String> {
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    let cfg = TunnelConfig {
        id: new_id(),
        name: config.name,
        jump_host_id: config.jump_host_id,
        remote_host: config.remote_host,
        remote_port: config.remote_port,
        local_port: config.local_port,
        created_at: now_ts(),
    };
    store.tunnel_configs.push(cfg.clone());
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[tauri::command]
pub async fn update_tunnel_config(
    app: tauri::AppHandle,
    config: UpdateTunnelConfig,
) -> Result<TunnelConfig, String> {
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    let pos = store.tunnel_configs.iter().position(|c| c.id == config.id)
        .ok_or_else(|| format!("Tunnel config {} not found", config.id))?;
    let updated = TunnelConfig {
        id: config.id,
        name: config.name,
        jump_host_id: config.jump_host_id,
        remote_host: config.remote_host,
        remote_port: config.remote_port,
        local_port: config.local_port,
        created_at: store.tunnel_configs[pos].created_at,
    };
    store.tunnel_configs[pos] = updated.clone();
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(updated)
}

#[tauri::command]
pub async fn delete_tunnel_config(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // Stop the tunnel if it's running before deleting the config.
    if let Some(tx) = TUNNEL_STOPS.lock().unwrap().remove(&id) {
        let _ = tx.send(());
    }
    TUNNELS.lock().unwrap().remove(&id);
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    store.tunnel_configs.retain(|c| c.id != id);
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(())
}
