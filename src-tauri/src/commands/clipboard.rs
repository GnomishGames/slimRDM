use std::any::Any;
use std::collections::HashMap;
use std::sync::Mutex;

use arboard::Clipboard;
use ironrdp::core::AsAny;
use ironrdp_cliprdr::pdu::{
    ClipboardFormat, ClipboardGeneralCapabilityFlags, FileContentsRequest, FileContentsResponse,
    FormatDataRequest, FormatDataResponse, LockDataId,
};
use ironrdp_cliprdr::backend::{CliprdrBackend, CliprdrBackendFactory};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const TEMP_DIR: &str = "/tmp/slimrdm-clipboard";

pub const CF_TEXT: u32 = 1;
pub const CF_UNICODETEXT: u32 = 13;

lazy_static::lazy_static! {
    static ref RDP_CLIPBOARD_DATA: Mutex<HashMap<String, Vec<u8>>> = Mutex::new(HashMap::new());
    static ref RDP_CLIPBOARD_PENDING: Mutex<Option<(String, u32)>> = Mutex::new(None);
    static ref RDP_FORMAT_LIST_PENDING: Mutex<bool> = Mutex::new(false);
    static ref RDP_INITIATE_PASTE: Mutex<Option<(String, u32)>> = Mutex::new(None);
    static ref RDP_REQUESTED_FORMAT: Mutex<Option<u32>> = Mutex::new(None);
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFormatDataRequestEvent {
    pub session_id: String,
    pub requested_format_id: u32,
}

#[tauri::command]
pub fn clipboard_get_system() -> Result<String, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_set_system(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_get_rdp(session_id: String) -> Option<Vec<u8>> {
    get_clipboard_data(&session_id)
}

#[tauri::command]
pub fn clipboard_set_rdp(session_id: String, data: Vec<u8>) {
    set_clipboard_data(&session_id, data);
}

pub fn get_pending_clipboard_request() -> Option<(String, u32)> {
    RDP_CLIPBOARD_PENDING.lock().unwrap().take()
}

pub fn take_format_list_pending() -> bool {
    let mut flag = RDP_FORMAT_LIST_PENDING.lock().unwrap();
    let val = *flag;
    *flag = false;
    val
}

pub fn set_format_list_pending() {
    *RDP_FORMAT_LIST_PENDING.lock().unwrap() = true;
}

pub fn take_initiate_paste() -> Option<(String, u32)> {
    RDP_INITIATE_PASTE.lock().unwrap().take()
}

pub fn set_requested_format(format_id: u32) {
    *RDP_REQUESTED_FORMAT.lock().unwrap() = Some(format_id);
}

pub fn set_clipboard_data(session_id: &str, data: Vec<u8>) {
    RDP_CLIPBOARD_DATA.lock().unwrap().insert(session_id.to_string(), data);
}

pub fn get_clipboard_data(session_id: &str) -> Option<Vec<u8>> {
    RDP_CLIPBOARD_DATA.lock().unwrap().remove(session_id)
}

pub struct TauriCliprdrBackendFactory {
    app: AppHandle,
    session_id: String,
}

impl TauriCliprdrBackendFactory {
    pub fn new(app: AppHandle, session_id: String) -> Self {
        std::fs::create_dir_all(TEMP_DIR).ok();
        Self { app, session_id }
    }
}

impl CliprdrBackendFactory for TauriCliprdrBackendFactory {
    fn build_cliprdr_backend(&self) -> Box<dyn CliprdrBackend> {
        Box::new(TauriCliprdrBackend::new(self.app.clone(), self.session_id.clone()))
    }
}

pub struct TauriCliprdrBackend {
    app: AppHandle,
    session_id: String,
    remote_formats: Vec<ClipboardFormat>,
}

impl TauriCliprdrBackend {
    pub fn new(app: AppHandle, session_id: String) -> Self {
        Self {
            app,
            session_id,
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
        *RDP_FORMAT_LIST_PENDING.lock().unwrap() = true;
    }

    fn on_process_negotiated_capabilities(&mut self, _capabilities: ClipboardGeneralCapabilityFlags) {}

    fn on_remote_copy(&mut self, available_formats: &[ClipboardFormat]) {
        self.remote_formats = available_formats.to_vec();

        // Prefer CF_UNICODETEXT (13), fall back to CF_TEXT (1)
        let preferred = available_formats.iter()
            .find(|f| f.id.0 == CF_UNICODETEXT)
            .or_else(|| available_formats.iter().find(|f| f.id.0 == CF_TEXT));

        if let Some(fmt) = preferred {
            *RDP_INITIATE_PASTE.lock().unwrap() = Some((self.session_id.clone(), fmt.id.0));
        }
    }

    fn on_format_data_request(&mut self, request: FormatDataRequest) {
        if request.format.0 == CF_TEXT || request.format.0 == CF_UNICODETEXT {
            if let Ok(mut clipboard) = Clipboard::new() {
                if let Ok(text) = clipboard.get_text() {
                    set_clipboard_data(&self.session_id, text.into_bytes());
                }
            }
        }
        *RDP_CLIPBOARD_PENDING.lock().unwrap() = Some((self.session_id.clone(), request.format.0));
        let _ = self.app.emit(
            "clipboard-format-data-request",
            ClipboardFormatDataRequestEvent {
                session_id: self.session_id.clone(),
                requested_format_id: request.format.0,
            },
        );
    }

    fn on_format_data_response(&mut self, response: FormatDataResponse<'_>) {
        if response.is_error() { return; }
        let data = response.data();
        let format = RDP_REQUESTED_FORMAT.lock().unwrap().take().unwrap_or(CF_UNICODETEXT);
        let text = if format == CF_UNICODETEXT {
            let utf16: Vec<u16> = data.chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let trimmed: Vec<u16> = utf16.into_iter().take_while(|&c| c != 0).collect();
            String::from_utf16_lossy(&trimmed)
        } else {
            String::from_utf8_lossy(data).trim_end_matches('\0').to_string()
        };
        if !text.is_empty() {
            let _ = self.app.emit("clipboard-remote-text", text);
        }
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
pub struct ClipboardFileContentsRequestEvent {
    pub stream_id: u32,
    pub flags: u32,
    pub offset: u64,
    pub size: u32,
    pub file_name: String,
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