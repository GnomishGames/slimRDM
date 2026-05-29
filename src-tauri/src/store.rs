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
    #[serde(default)]
    pub use_group_credentials: bool,
    #[serde(default)]
    pub jump_host_id: Option<String>,
    pub working_directory: Option<String>,
    pub shell_path: Option<String>,
    pub startup_commands: Option<String>,
    #[serde(default)]
    pub auto_connect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionType {
    Ssh,
    Rdp,
    Trm,
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
pub struct Category {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCategory {
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCategory {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub username: Option<String>,
    pub credential_ref: Option<String>,
    pub auth_type: Option<AuthType>,
    pub private_key_path: Option<String>,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelConfig {
    pub id: String,
    pub name: String,
    pub jump_host_id: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub local_port: u16,
    pub created_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTunnelConfig {
    pub name: String,
    pub jump_host_id: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub local_port: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTunnelConfig {
    pub id: String,
    pub name: String,
    pub jump_host_id: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub local_port: u16,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStore {
    pub connections: Vec<Connection>,
    pub groups: Vec<Group>,
    #[serde(default)]
    pub categories: Vec<Category>,
    #[serde(default)]
    pub tunnel_configs: Vec<TunnelConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConnection {
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connection_type: ConnectionType,
    pub group_id: Option<String>,
    pub auth_type: AuthType,
    pub private_key_path: Option<String>,
    pub credential_ref: Option<String>,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub use_group_credentials: bool,
    #[serde(default)]
    pub jump_host_id: Option<String>,
    pub working_directory: Option<String>,
    pub shell_path: Option<String>,
    pub startup_commands: Option<String>,
    #[serde(default)]
    pub auto_connect: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGroup {
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGroup {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub username: Option<String>,
    pub credential_ref: Option<String>,
    pub auth_type: Option<AuthType>,
    pub private_key_path: Option<String>,
    pub category_id: Option<String>,
}

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
