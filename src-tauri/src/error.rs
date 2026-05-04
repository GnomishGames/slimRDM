use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
pub enum SlimError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Authentication failed: {0}")]
    AuthFailed(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Store error: {0}")]
    StoreError(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("SSH error: {0}")]
    Ssh(String),

    #[error("RDP error: {0}")]
    Rdp(String),
}

impl From<std::io::Error> for SlimError {
    fn from(e: std::io::Error) -> Self {
        SlimError::Io(e.to_string())
    }
}

// Tauri requires errors to be serializable
impl From<SlimError> for tauri::Error {
    fn from(e: SlimError) -> Self {
        tauri::Error::Anyhow(anyhow::anyhow!(e.to_string()))
    }
}

pub type Result<T> = std::result::Result<T, SlimError>;
