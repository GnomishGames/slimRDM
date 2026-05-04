use crate::store::{Group, new_id};
use super::connections::{load_store, save_store};

#[tauri::command]
pub async fn list_groups(app: tauri::AppHandle) -> std::result::Result<Vec<Group>, String> {
    load_store(&app)
        .map(|s| s.groups)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_group(app: tauri::AppHandle, mut group: Group) -> std::result::Result<Group, String> {
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    group.id = new_id();
    store.groups.push(group.clone());
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(group)
}

#[tauri::command]
pub async fn delete_group(app: tauri::AppHandle, id: String) -> std::result::Result<(), String> {
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    store.groups.retain(|g| g.id != id);
    // Ungroup any connections in this group
    for conn in store.connections.iter_mut() {
        if conn.group_id.as_deref() == Some(&id) {
            conn.group_id = None;
        }
    }
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(())
}
