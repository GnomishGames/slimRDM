use tauri_plugin_store::StoreExt;
use serde_json::json;

use crate::store::{Connection, NewConnection, AppStore, new_id, now_ts};
use crate::error::{SlimError, Result};

const STORE_KEY: &str = "data";

pub(crate) fn load_store(app: &tauri::AppHandle) -> Result<AppStore> {
    let store = app.store("slimrdm.json")
        .map_err(|e| SlimError::StoreError(e.to_string()))?;
    let data = store.get(STORE_KEY);
    match data {
        Some(v) => serde_json::from_value(v.clone())
            .map_err(|e| SlimError::StoreError(e.to_string())),
        None => Ok(AppStore::default()),
    }
}

pub(crate) fn save_store(app: &tauri::AppHandle, data: &AppStore) -> Result<()> {
    let store = app.store("slimrdm.json")
        .map_err(|e| SlimError::StoreError(e.to_string()))?;
    store.set(STORE_KEY, json!(data));
    store.save().map_err(|e| SlimError::StoreError(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn list_connections(app: tauri::AppHandle) -> std::result::Result<Vec<Connection>, String> {
    load_store(&app)
        .map(|mut s| {
            s.connections.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
            s.connections
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connection(app: tauri::AppHandle, id: String) -> std::result::Result<Connection, String> {
    let store = load_store(&app).map_err(|e| e.to_string())?;
    store.connections
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Connection {} not found", id))
}

#[tauri::command]
pub async fn add_connection(app: tauri::AppHandle, connection: NewConnection) -> std::result::Result<Connection, String> {
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    let conn = Connection {
        id: new_id(),
        created_at: now_ts(),
        last_connected: None,
        label: connection.label,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        connection_type: connection.connection_type,
        group_id: connection.group_id,
        auth_type: connection.auth_type,
        private_key_path: connection.private_key_path,
        credential_ref: connection.credential_ref,
        notes: connection.notes,
        tags: connection.tags,
        use_group_credentials: connection.use_group_credentials,
        jump_host_id: connection.jump_host_id,
        working_directory: connection.working_directory,
        shell_path: connection.shell_path,
    };
    store.connections.push(conn.clone());
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
pub async fn update_connection(app: tauri::AppHandle, connection: Connection) -> std::result::Result<Connection, String> {
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    let pos = store.connections.iter().position(|c| c.id == connection.id)
        .ok_or_else(|| format!("Connection {} not found", connection.id))?;
    store.connections[pos] = connection.clone();
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(connection)
}

#[tauri::command]
pub async fn delete_connection(app: tauri::AppHandle, id: String) -> std::result::Result<(), String> {
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    store.connections.retain(|c| c.id != id);
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(())
}
