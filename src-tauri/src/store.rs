use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connection_type: ConnectionType,
    pub group_id: Option<String>,
    pub auth_type: AuthType,
    /// For key auth: path to private key file
    pub private_key_path: Option<String>,
    /// For password auth: keyring reference key (not the password itself)
    pub credential_ref: Option<String>,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    pub created_at: u64,
    pub last_connected: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionType {
    Ssh,
    Rdp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Password,
    PublicKey,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStore {
    pub connections: Vec<Connection>,
    pub groups: Vec<Group>,
}

const STORE_FILE: &str = "slimrdm.json";

pub fn init(_app: &AppHandle) -> anyhow::Result<()> {
    // tauri-plugin-store handles init automatically
    Ok(())
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn now_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
