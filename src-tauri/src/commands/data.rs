use std::fs;
use serde::{Deserialize, Serialize};

use crate::store::{AppStore, Category, Connection, Group, TunnelConfig};
use crate::commands::connections::{load_store, save_store};

/// Bumped to 2 when categories and tunnels joined the format. Version 1 files
/// still import — both default to empty — they just arrive without them.
const EXPORT_VERSION: u32 = 2;

#[derive(Serialize, Deserialize)]
struct ExportFile {
    version: u32,
    connections: Vec<Connection>,
    groups: Vec<Group>,
    #[serde(default)]
    categories: Vec<Category>,
    #[serde(default)]
    tunnel_configs: Vec<TunnelConfig>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub connections_added: usize,
    pub groups_added: usize,
    pub categories_added: usize,
    pub tunnels_added: usize,
}

fn build_export(store: &AppStore) -> ExportFile {
    ExportFile {
        version: EXPORT_VERSION,
        connections: store.connections.clone(),
        groups: store.groups.clone(),
        categories: store.categories.clone(),
        tunnel_configs: store.tunnel_configs.clone(),
    }
}

fn merge_into(store: &mut AppStore, imported: ExportFile) -> ImportResult {
    let mut groups_added = 0usize;
    let mut connections_added = 0usize;
    let mut categories_added = 0usize;
    let mut tunnels_added = 0usize;

    // Categories first: a group whose category is missing has nowhere to render.
    for category in imported.categories {
        if !store.categories.iter().any(|c| c.id == category.id) {
            store.categories.push(category);
            categories_added += 1;
        }
    }

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

    for tunnel in imported.tunnel_configs {
        if !store.tunnel_configs.iter().any(|t| t.id == tunnel.id) {
            store.tunnel_configs.push(tunnel);
            tunnels_added += 1;
        }
    }

    ImportResult { connections_added, groups_added, categories_added, tunnels_added }
}

#[tauri::command]
pub async fn export_data(app: tauri::AppHandle, path: String) -> std::result::Result<(), String> {
    let store = load_store(&app).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&build_export(&store)).map_err(|e| e.to_string())?;
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

    let result = merge_into(&mut store, imported);
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{AuthType, ConnectionType};

    fn connection(id: &str, label: &str, group_id: Option<&str>) -> Connection {
        Connection {
            id: id.into(),
            label: label.into(),
            host: "host".into(),
            port: 22,
            username: "user".into(),
            connection_type: ConnectionType::Ssh,
            group_id: group_id.map(Into::into),
            auth_type: AuthType::Password,
            private_key_path: None,
            credential_ref: None,
            notes: None,
            tags: vec![],
            created_at: 0,
            last_connected: None,
            use_group_credentials: false,
            jump_host_id: None,
            working_directory: None,
            shell_path: None,
            startup_commands: None,
            auto_connect: false,
            log_sessions: Default::default(),
            allow_legacy_crypto: false,
        }
    }

    fn group(id: &str, name: &str, category_id: Option<&str>) -> Group {
        Group {
            id: id.into(),
            name: name.into(),
            parent_id: None,
            color: None,
            icon: None,
            username: None,
            credential_ref: None,
            auth_type: None,
            private_key_path: None,
            category_id: category_id.map(Into::into),
            log_sessions: Default::default(),
        }
    }

    fn category(id: &str, name: &str) -> Category {
        Category { id: id.into(), name: name.into() }
    }

    fn tunnel(id: &str, name: &str) -> TunnelConfig {
        TunnelConfig {
            id: id.into(),
            name: name.into(),
            jump_host_id: "c1".into(),
            remote_host: "zabbix.internal".into(),
            remote_port: 443,
            local_port: 8443,
            created_at: 0,
        }
    }

    fn sample_store() -> AppStore {
        AppStore {
            connections: vec![connection("c1", "SWC104", Some("g1"))],
            groups: vec![group("g1", "Core Switches", Some("cat1"))],
            categories: vec![category("cat1", "Switches")],
            tunnel_configs: vec![tunnel("t1", "zabbix")],
        }
    }

    /// Export to JSON and read it back, the way a backup file crosses machines.
    fn round_trip(store: &AppStore) -> ExportFile {
        let json = serde_json::to_string(&build_export(store)).unwrap();
        serde_json::from_str(&json).unwrap()
    }

    #[test]
    fn export_file_carries_categories() {
        let json = serde_json::to_value(build_export(&sample_store())).unwrap();

        assert_eq!(json["categories"][0]["name"], "Switches");
    }

    #[test]
    fn imported_group_keeps_a_category_that_exists() {
        let mut fresh = AppStore::default();

        merge_into(&mut fresh, round_trip(&sample_store()));

        let imported_group = &fresh.groups[0];
        assert_eq!(imported_group.category_id.as_deref(), Some("cat1"));
        assert!(
            fresh.categories.iter().any(|c| Some(c.id.as_str()) == imported_group.category_id.as_deref()),
            "group's category must be imported too, or the group renders nowhere",
        );
    }

    #[test]
    fn a_backup_carries_saved_tunnels() {
        // A "replace" import rebuilds the store from the backup alone, so
        // anything the file does not carry is destroyed on disk.
        let mut fresh = AppStore::default();

        merge_into(&mut fresh, round_trip(&sample_store()));

        assert_eq!(fresh.tunnel_configs.len(), 1);
        assert_eq!(fresh.tunnel_configs[0].name, "zabbix");
    }

    #[test]
    fn importing_the_same_file_twice_adds_nothing_the_second_time() {
        let mut store = AppStore::default();
        merge_into(&mut store, round_trip(&sample_store()));

        let second = merge_into(&mut store, round_trip(&sample_store()));

        assert_eq!(store.categories.len(), 1);
        assert_eq!(store.groups.len(), 1);
        assert_eq!(store.connections.len(), 1);
        assert_eq!(store.tunnel_configs.len(), 1);
        assert_eq!(serde_json::to_value(&second).unwrap()["categoriesAdded"], 0);
        assert_eq!(serde_json::to_value(&second).unwrap()["tunnelsAdded"], 0);
    }

    #[test]
    fn legacy_export_without_categories_still_imports() {
        let legacy = r#"{"version":1,"connections":[],"groups":[]}"#;

        let file: ExportFile = serde_json::from_str(legacy).expect("v1 backups must still load");
        let mut store = AppStore::default();
        merge_into(&mut store, file);

        assert!(store.categories.is_empty());
    }

    #[test]
    fn import_result_uses_camel_case_keys_for_the_frontend() {
        let mut fresh = AppStore::default();

        let result = merge_into(&mut fresh, round_trip(&sample_store()));

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["connectionsAdded"], 1);
        assert_eq!(json["groupsAdded"], 1);
        assert_eq!(json["categoriesAdded"], 1);
        assert_eq!(json["tunnelsAdded"], 1);
    }
}
