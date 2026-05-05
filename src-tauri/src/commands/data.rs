use std::fs;
use serde::{Deserialize, Serialize};

use crate::store::{AppStore, Connection, Group};
use crate::commands::connections::{load_store, save_store};

#[derive(Serialize, Deserialize)]
struct ExportFile {
    version: u32,
    connections: Vec<Connection>,
    groups: Vec<Group>,
}

#[derive(Serialize)]
pub struct ImportResult {
    pub connections_added: usize,
    pub groups_added: usize,
}

#[tauri::command]
pub async fn export_data(app: tauri::AppHandle, path: String) -> std::result::Result<(), String> {
    let store = load_store(&app).map_err(|e| e.to_string())?;
    let file = ExportFile {
        version: 1,
        connections: store.connections,
        groups: store.groups,
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn import_data(
    app: tauri::AppHandle,
    path: String,
    replace: bool,
) -> std::result::Result<ImportResult, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let imported: ExportFile =
        serde_json::from_str(&content).map_err(|e| format!("Invalid file: {}", e))?;

    let mut store = if replace {
        AppStore::default()
    } else {
        load_store(&app).map_err(|e| e.to_string())?
    };

    let mut groups_added = 0usize;
    let mut connections_added = 0usize;

    for group in imported.groups {
        if !store.groups.iter().any(|g| g.id == group.id) {
            store.groups.push(group);
            groups_added += 1;
        }
    }

    for conn in imported.connections {
        if !store.connections.iter().any(|c| c.id == conn.id) {
            store.connections.push(conn);
            connections_added += 1;
        }
    }

    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(ImportResult { connections_added, groups_added })
}
