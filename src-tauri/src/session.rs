use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionType {
    Ssh,
    Rdp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Connecting,
    Connected,
    Disconnected,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub connection_id: String,
    pub session_type: SessionType,
    pub status: SessionStatus,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub label: String,
    pub opened_at: u64,
}

pub struct SshSession {
    pub info: SessionInfo,
    pub input_tx: mpsc::UnboundedSender<String>,
}

pub struct RdpSession {
    pub info: SessionInfo,
}

pub enum ActiveSession {
    Ssh(SshSession),
    Rdp(RdpSession),
}

impl ActiveSession {
    pub fn info(&self) -> &SessionInfo {
        match self {
            ActiveSession::Ssh(s) => &s.info,
            ActiveSession::Rdp(s) => &s.info,
        }
    }

    pub fn info_mut(&mut self) -> &mut SessionInfo {
        match self {
            ActiveSession::Ssh(s) => &mut s.info,
            ActiveSession::Rdp(s) => &mut s.info,
        }
    }
}

pub type SessionStore = Arc<Mutex<HashMap<String, ActiveSession>>>;

pub fn new_session_store() -> SessionStore {
    Arc::new(Mutex::new(HashMap::new()))
}
