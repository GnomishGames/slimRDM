use std::any::Any;
use std::path::PathBuf;

use ironrdp::core::AsAny;
use ironrdp_cliprdr::pdu::{
    ClipboardFormat, ClipboardFormatId, ClipboardGeneralCapabilityFlags, FileContentsRequest, FileContentsResponse,
    FormatDataRequest, FormatDataResponse, LockDataId,
};
use ironrdp_cliprdr::backend::{CliprdrBackend, CliprdrBackendFactory};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const TEMP_DIR: &str = "/tmp/slimrdm-clipboard";

pub struct TauriCliprdrBackendFactory {
    app: AppHandle,
}

impl TauriCliprdrBackendFactory {
    pub fn new(app: AppHandle) -> Self {
        std::fs::create_dir_all(TEMP_DIR).ok();
        Self { app }
    }
}

impl CliprdrBackendFactory for TauriCliprdrBackendFactory {
    fn build_cliprdr_backend(&self) -> Box<dyn CliprdrBackend> {
        Box::new(TauriCliprdrBackend::new(self.app.clone()))
    }
}

pub struct TauriCliprdrBackend {
    app: AppHandle,
    remote_formats: Vec<ClipboardFormat>,
}

impl TauriCliprdrBackend {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            remote_formats: Vec::new(),
        }
    }
}

impl CliprdrBackend for TauriCliprdrBackend {
    fn temporary_directory(&self) -> &str {
        TEMP_DIR
    }

    fn client_capabilities(&self) -> ClipboardGeneralCapabilityFlags {
        ClipboardGeneralCapabilityFlags::empty()
    }

    fn on_ready(&mut self) {
        let _ = self.app.emit("clipboard-ready", ());
    }

    fn on_request_format_list(&mut self) {
        let _ = self.app.emit("clipboard-request-format-list", ());
    }

    fn on_process_negotiated_capabilities(&mut self, _capabilities: ClipboardGeneralCapabilityFlags) {}

    fn on_remote_copy(&mut self, available_formats: &[ClipboardFormat]) {
        self.remote_formats = available_formats.to_vec();
        let formats: Vec<ClipboardFormatEvent> = available_formats
            .iter()
            .map(|f| ClipboardFormatEvent {
                id: f.id.0,
                name: f.name.as_ref().map(|n| n.value().to_string()),
            })
            .collect();
        let _ = self.app.emit("clipboard-remote-copy", formats);
    }

    fn on_format_data_request(&mut self, request: FormatDataRequest) {
        let _ = self.app.emit(
            "clipboard-format-data-request",
            ClipboardFormatDataRequestEvent {
                requested_format_id: request.format.0,
            },
        );
    }

    fn on_format_data_response(&mut self, _response: FormatDataResponse<'_>) {
        let _ = self.app.emit("clipboard-format-data-response", ());
    }

    fn on_file_contents_request(&mut self, request: FileContentsRequest) {
        let _ = self.app.emit(
            "clipboard-file-contents-request",
            ClipboardFileContentsRequestEvent {
                stream_id: request.stream_id,
                flags: request.flags.bits(),
                offset: request.position,
                size: request.requested_size,
                file_name: "".to_string(),
            },
        );
    }

    fn on_file_contents_response(&mut self, _response: FileContentsResponse<'_>) {
        let _ = self.app.emit("clipboard-file-contents-response", ());
    }

    fn on_lock(&mut self, data_id: LockDataId) {
        let _ = self.app.emit("clipboard-lock", data_id.0);
    }

    fn on_unlock(&mut self, data_id: LockDataId) {
        let _ = self.app.emit("clipboard-unlock", data_id.0);
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFormatEvent {
    pub id: u32,
    pub name: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFormatDataRequestEvent {
    pub requested_format_id: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFormatDataResponseEvent {
    pub data: Vec<u8>,
    pub is_error: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFileContentsRequestEvent {
    pub stream_id: u32,
    pub flags: u32,
    pub offset: u64,
    pub size: u32,
    pub file_name: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFileContentsResponseEvent {
    pub stream_id: u32,
    pub flags: u32,
    pub data: Vec<u8>,
    pub is_error: bool,
}

impl std::fmt::Debug for TauriCliprdrBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TauriCliprdrBackend").finish()
    }
}

impl AsAny for TauriCliprdrBackend {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}