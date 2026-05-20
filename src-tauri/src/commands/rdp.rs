use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;

use ironrdp::connector::{ClientConnector, Config, Credentials, DesktopSize, ServerName};
use ironrdp::session::{ActiveStage, ActiveStageOutput};
use ironrdp::session::image::DecodedImage;
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
use ironrdp::pdu::input::mouse::{MousePdu, PointerFlags};
use ironrdp::pdu::rdp::client_info::{PerformanceFlags, TimezoneInfo};
use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp::pdu::gcc::KeyboardType;
use ironrdp_tokio::{self as rdp_tokio, FramedWrite, TokioFramed};
use ironrdp_cliprdr::{Cliprdr, Client};
use ironrdp_cliprdr::pdu::{ClipboardFormat, ClipboardFormatId, FormatDataResponse};
use ironrdp_cliprdr::backend::CliprdrBackendFactory;

use crate::commands::tunnel_utils::{JumpHostParams, open_jump_channel};
use crate::commands::clipboard::{
    TauriCliprdrBackendFactory, get_clipboard_data,
    take_format_list_pending, set_format_list_pending, get_pending_clipboard_request,
    take_initiate_paste, set_requested_format, CF_TEXT, CF_UNICODETEXT,
};

enum SessionInput {
    MouseEvent { flags: u16, x: u16, y: u16, wheel_units: i16 },
    KeyEvent { flags: u8, scancode: u8 },
    UnicodeText(Vec<u16>),
    Resize { width: u16, height: u16 },
    Disconnect,
}

lazy_static::lazy_static! {
    static ref RDP_SESSIONS: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<SessionInput>>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpConnectParams {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub credential_ref: Option<String>,
    pub domain: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub performance_flags: Option<RdpPerformanceFlags>,
    pub connection_quality: Option<String>,
    pub jump_host_params: Option<JumpHostParams>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpPerformanceFlags {
    pub disable_wallpaper: bool,
    pub disable_font_smoothing: bool,
    pub disable_animation: bool,
    pub disable_theme: bool,
    pub disable_menu_animations: bool,
    pub disable_cursor_shadow: bool,
    pub disable_cursor_blinking: bool,
    pub enable_desktop_composition: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RdpStatusEvent {
    session_id: String,
    status: String,
    message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RdpFrameEvent {
    session_id: String,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    full_width: u16,
    full_height: u16,
    data: String, // base64 raw RGBA
}

#[tauri::command]
pub async fn rdp_connect(app: AppHandle, params: RdpConnectParams) -> Result<(), String> {
    let (input_tx, input_rx) = mpsc::unbounded_channel::<SessionInput>();
    {
        RDP_SESSIONS.lock().unwrap().insert(params.session_id.clone(), input_tx);
    }

    let session_id = params.session_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        let result = run_rdp_session(&app_clone, params, input_rx).await;
        RDP_SESSIONS.lock().unwrap().remove(&session_id);
        let (status, message) = match result {
            Ok(()) => ("disconnected".to_string(), None),
            Err(e) => ("error".to_string(), Some(e)),
        };
        let _ = app_clone.emit("rdp-status", RdpStatusEvent { session_id, status, message });
    });

    Ok(())
}

async fn run_rdp_session(
    app: &AppHandle,
    params: RdpConnectParams,
    input_rx: mpsc::UnboundedReceiver<SessionInput>,
) -> Result<(), String> {
    let session_id = params.session_id.clone();
    emit_status(app, &session_id, "connecting", None);

    if let Some(ref jump) = params.jump_host_params {
        let stream = open_jump_channel(jump, &params.host, params.port)
            .await
            .map_err(|e| format!("Jump host error: {e}"))?;
        let client_addr: std::net::SocketAddr = "127.0.0.1:0".parse().unwrap();
        run_rdp_inner(app, params, input_rx, stream, client_addr).await
    } else {
        let tcp = TcpStream::connect(format!("{}:{}", params.host, params.port))
            .await
            .map_err(|e| format!("TCP connect failed: {e}"))?;
        let client_addr = tcp.local_addr().map_err(|e| e.to_string())?;
        run_rdp_inner(app, params, input_rx, tcp, client_addr).await
    }
}

async fn run_rdp_inner<S>(
    app: &AppHandle,
    params: RdpConnectParams,
    mut input_rx: mpsc::UnboundedReceiver<SessionInput>,
    stream: S,
    client_addr: std::net::SocketAddr,
) -> Result<(), String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
{
    let session_id = params.session_id.clone();

    let width = params.width.unwrap_or(1280) as u16;
    let height = params.height.unwrap_or(800) as u16;

    let password = params.credential_ref.as_deref()
        .and_then(crate::commands::credentials::get_credential_sync)
        .unwrap_or_default();
    let config = Config {
        credentials: Credentials::UsernamePassword {
            username: params.username.clone(),
            password,
        },
        domain: params.domain.clone(),
        enable_tls: true,
        enable_credssp: true,
        keyboard_type: KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_layout: 0,
        keyboard_functional_keys_count: 12,
        ime_file_name: String::new(),
        dig_product_id: String::new(),
        desktop_size: DesktopSize { width, height },
        bitmap: None,
        client_build: 0,
        client_name: "SlimRDM".to_owned(),
        client_dir: "C:\\Windows\\System32\\mstscax.dll".to_owned(),
        platform: MajorPlatformType::UNIX,
        enable_server_pointer: true,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        pointer_software_rendering: false,
        performance_flags: params.performance_flags.as_ref()
            .map(build_performance_flags)
            .unwrap_or_else(|| match params.connection_quality.as_deref() {
                Some("lan") => PerformanceFlags::empty(),
                Some("broadband") => PerformanceFlags::DISABLE_WALLPAPER
                    | PerformanceFlags::ENABLE_FONT_SMOOTHING
                    | PerformanceFlags::DISABLE_MENUANIMATIONS,
                Some("modem") => PerformanceFlags::all(),
                _ => PerformanceFlags::default(),
            }),
        desktop_scale_factor: 0,
        hardware_id: None,
        license_cache: None,
        timezone_info: TimezoneInfo::default(),
    };

    let mut framed = TokioFramed::new(stream);
    let connector = ClientConnector::new(config, client_addr);

    let clipboard_factory = TauriCliprdrBackendFactory::new(app.clone(), params.session_id.clone());
    let cliprdr: Cliprdr<ironrdp_cliprdr::Client> = Cliprdr::new(clipboard_factory.build_cliprdr_backend());
    let mut connector = connector.with_static_channel(cliprdr);

    let should_upgrade = rdp_tokio::connect_begin(&mut framed, &mut connector)
        .await
        .map_err(|e| format!("Negotiation failed: {e}"))?;

    let raw_stream = framed.into_inner_no_leftover();
    let (tls_stream, tls_cert) = ironrdp_tls::upgrade(raw_stream, &params.host)
        .await
        .map_err(|e| format!("TLS upgrade failed: {e}"))?;

    let server_public_key = ironrdp_tls::extract_tls_server_public_key(&tls_cert)
        .ok_or("Failed to extract server public key")?
        .to_owned();

    let upgraded = rdp_tokio::mark_as_upgraded(should_upgrade, &mut connector);
    let mut upgraded_framed = TokioFramed::new(tls_stream);

    let connection_result = rdp_tokio::connect_finalize(
        upgraded,
        connector,
        &mut upgraded_framed,
        &mut rdp_tokio::reqwest::ReqwestNetworkClient::new(),
        ServerName::from(params.host.clone()),
        server_public_key,
        None,
    )
    .await
    .map_err(|e| format!("Authentication failed: {e}"))?;

    emit_status(app, &session_id, "connected", None);

    let (mut reader, mut writer) = rdp_tokio::split_tokio_framed(upgraded_framed);
    let mut image = DecodedImage::new(
        PixelFormat::RgbA32,
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );
    let mut active_stage = ActiveStage::new(connection_result);
    let frame_budget = match params.connection_quality.as_deref() {
        Some("lan")       => Duration::from_millis(8),   // ~120fps
        Some("broadband") => Duration::from_millis(33),  // ~30fps
        Some("modem")     => Duration::from_millis(100), // ~10fps
        _                 => Duration::from_millis(16),  // ~60fps (auto/default)
    };
    let mut last_frame = Instant::now();
    // Union of all dirty regions not yet emitted. Carried across loop iterations
    // so updates are never dropped when the frame timer isn't ready.
    let mut pending_dirty: Option<(u16, u16, u16, u16)> = None; // (left, top, right, bottom)

    loop {
        let (outputs, resize_bytes) = tokio::select! {
            frame = reader.read_pdu() => {
                let (action, payload) = frame.map_err(|e| format!("Read error: {e}"))?;
                let outputs = active_stage.process(&mut image, action, &payload)
                    .map_err(|e| format!("Session error: {e}"))?;
                (outputs, None)
            }
            input = input_rx.recv() => {
                match input {
                    None | Some(SessionInput::Disconnect) => break,
                    Some(SessionInput::Resize { width, height }) => {
                        let bytes = active_stage
                            .encode_resize(u32::from(width), u32::from(height), None, None)
                            .and_then(|r| r.ok());
                        (vec![], bytes)
                    }
                    Some(event) => {
                        let outputs = handle_input(&mut active_stage, &mut image, event)
                            .map_err(|e| format!("Input error: {e}"))?;
                        (outputs, None)
                    }
                }
            }
        };

        if let Some(bytes) = resize_bytes {
            writer.write_all(&bytes).await.map_err(|e| format!("Write error: {e}"))?;
        }

        let mut terminate = false;
        for output in outputs {
            match output {
                ActiveStageOutput::ResponseFrame(frame) => {
                    writer.write_all(&frame).await.map_err(|e| format!("Write error: {e}"))?;
                }
                ActiveStageOutput::GraphicsUpdate(region) => {
                    // Merge into pending dirty union — never drop a region
                    pending_dirty = Some(match pending_dirty {
                        None => (region.left, region.top, region.right, region.bottom),
                        Some((l, t, r, b)) => (
                            l.min(region.left),
                            t.min(region.top),
                            r.max(region.right),
                            b.max(region.bottom),
                        ),
                    });
                }
                ActiveStageOutput::Terminate(_) => { terminate = true; }
                _ => {}
            }
        }

        // Send clipboard format list when the channel requests it (Monitor Ready flow)
        if take_format_list_pending(&session_id) {
            let formats = vec![
                ClipboardFormat::new(ClipboardFormatId(CF_TEXT)),
                ClipboardFormat::new(ClipboardFormatId(CF_UNICODETEXT)),
            ];
            let messages = active_stage
                .get_svc_processor_mut::<Cliprdr<Client>>()
                .and_then(|cliprdr| cliprdr.initiate_copy(&formats).ok());
            if let Some(messages) = messages {
                if let Ok(bytes) = active_stage.process_svc_processor_messages(messages) {
                    writer.write_all(&bytes).await.map_err(|e| format!("Write error: {e}"))?;
                }
            }
        }

        // Respond to server's clipboard format data request
        if let Some(format_id) = get_pending_clipboard_request(&session_id) {
            let data = get_clipboard_data(&session_id);
            let response = match data {
                Some(bytes) => {
                    let encoded = if format_id == CF_UNICODETEXT {
                        let text = String::from_utf8_lossy(&bytes);
                        let mut utf16: Vec<u8> = text.encode_utf16()
                            .flat_map(|c| c.to_le_bytes())
                            .collect();
                        utf16.extend_from_slice(&[0, 0]);
                        utf16
                    } else {
                        let mut b = bytes;
                        b.push(0);
                        b
                    };
                    FormatDataResponse::new_data(encoded)
                }
                None => FormatDataResponse::new_error(),
            };
            let messages = active_stage
                .get_svc_processor_mut::<Cliprdr<Client>>()
                .and_then(|cliprdr| cliprdr.submit_format_data(response).ok());
            if let Some(messages) = messages {
                if let Ok(bytes) = active_stage.process_svc_processor_messages(messages) {
                    writer.write_all(&bytes).await.map_err(|e| format!("Write error: {e}"))?;
                }
                // Re-announce format list so the server keeps requesting fresh data
                // on each subsequent paste instead of using its local cached copy.
                set_format_list_pending(&session_id);
            }
        }

        // Request clipboard data from server after remote copy
        if let Some(format_id) = take_initiate_paste(&session_id) {
            {
                set_requested_format(&session_id, format_id);
                let messages = active_stage
                    .get_svc_processor_mut::<Cliprdr<Client>>()
                    .and_then(|cliprdr| cliprdr.initiate_paste(ClipboardFormatId(format_id)).ok());
                if let Some(messages) = messages {
                    if let Ok(bytes) = active_stage.process_svc_processor_messages(messages) {
                        writer.write_all(&bytes).await.map_err(|e| format!("Write error: {e}"))?;
                    }
                }
            }
        }

        // Emit the accumulated dirty union once per frame budget
        if let Some((left, top, right, bottom)) = pending_dirty {
            if last_frame.elapsed() >= frame_budget {
                last_frame = Instant::now();
                pending_dirty = None;
                let x = left as usize;
                let y = top as usize;
                let w = (right.saturating_sub(left) + 1) as usize;
                let h = (bottom.saturating_sub(top) + 1) as usize;
                let stride = image.width() as usize * 4;
                let src = image.data();
                let mut pixels = Vec::with_capacity(w * h * 4);
                for row in y..y + h {
                    let start = row * stride + x * 4;
                    let end = start + w * 4;
                    if end <= src.len() {
                        pixels.extend_from_slice(&src[start..end]);
                    }
                }
                let _ = app.emit("rdp-frame", RdpFrameEvent {
                    session_id: session_id.clone(),
                    x: left,
                    y: top,
                    width: w as u16,
                    height: h as u16,
                    full_width: image.width(),
                    full_height: image.height(),
                    data: BASE64.encode(&pixels),
                });
            }
        }

        if terminate { return Ok(()); }
    }

    Ok(())
}

fn handle_input(
    stage: &mut ActiveStage,
    image: &mut DecodedImage,
    input: SessionInput,
) -> Result<Vec<ActiveStageOutput>, ironrdp::session::SessionError> {
    let events: Vec<FastPathInputEvent> = match input {
        SessionInput::MouseEvent { flags, x, y, wheel_units } => vec![
            FastPathInputEvent::MouseEvent(MousePdu {
                flags: PointerFlags::from_bits_truncate(flags),
                number_of_wheel_rotation_units: wheel_units,
                x_position: x,
                y_position: y,
            }),
        ],
        SessionInput::KeyEvent { flags, scancode } => vec![
            FastPathInputEvent::KeyboardEvent(
                KeyboardFlags::from_bits_truncate(flags),
                scancode,
            ),
        ],
        SessionInput::UnicodeText(chars) => {
            let mut events = Vec::with_capacity(chars.len() * 2);
            for ch in chars {
                events.push(FastPathInputEvent::UnicodeKeyboardEvent(KeyboardFlags::empty(), ch));
                events.push(FastPathInputEvent::UnicodeKeyboardEvent(KeyboardFlags::RELEASE, ch));
            }
            events
        }
        SessionInput::Resize { .. } | SessionInput::Disconnect => return Ok(vec![]),
    };

    stage.process_fastpath_input(image, &events)
}

fn emit_status(app: &AppHandle, session_id: &str, status: &str, message: Option<String>) {
    let _ = app.emit("rdp-status", RdpStatusEvent {
        session_id: session_id.to_string(),
        status: status.to_string(),
        message,
    });
}

#[tauri::command]
pub async fn rdp_disconnect(session_id: String) -> Result<(), String> {
    let tx = RDP_SESSIONS.lock().unwrap().remove(&session_id);
    if let Some(tx) = tx {
        let _ = tx.send(SessionInput::Disconnect);
    }
    Ok(())
}

#[tauri::command]
pub async fn rdp_mouse_event(session_id: String, flags: u16, x: u16, y: u16, wheel_units: i16) -> Result<(), String> {
    send_input(&session_id, SessionInput::MouseEvent { flags, x, y, wheel_units })
}

#[tauri::command]
pub async fn rdp_key_event(session_id: String, flags: u8, scancode: u8) -> Result<(), String> {
    send_input(&session_id, SessionInput::KeyEvent { flags, scancode })
}

#[tauri::command]
pub async fn rdp_type_text(session_id: String, text: String) -> Result<(), String> {
    let chars: Vec<u16> = text.encode_utf16().collect();
    send_input(&session_id, SessionInput::UnicodeText(chars))
}

#[tauri::command]
pub async fn rdp_resize(session_id: String, width: u16, height: u16) -> Result<(), String> {
    send_input(&session_id, SessionInput::Resize { width, height })
}

fn send_input(session_id: &str, input: SessionInput) -> Result<(), String> {
    let sessions = RDP_SESSIONS.lock().unwrap();
    if let Some(tx) = sessions.get(session_id) {
        let _ = tx.send(input);
    }
    Ok(())
}

fn build_performance_flags(flags: &RdpPerformanceFlags) -> PerformanceFlags {
    let mut pf = PerformanceFlags::empty();
    if flags.disable_wallpaper { pf |= PerformanceFlags::DISABLE_WALLPAPER; }
    // ENABLE_FONT_SMOOTHING is inverted - setting it enables smoothing
    // To disable font smoothing, we leave this flag unset
    if flags.disable_menu_animations { pf |= PerformanceFlags::DISABLE_MENUANIMATIONS; }
    if flags.disable_theme { pf |= PerformanceFlags::DISABLE_THEMING; }
    // DISABLE_CURSORSETTINGS covers both cursor shadow and blinking
    if flags.disable_cursor_shadow || flags.disable_cursor_blinking { pf |= PerformanceFlags::DISABLE_CURSORSETTINGS; }
    if flags.enable_desktop_composition { pf |= PerformanceFlags::ENABLE_DESKTOP_COMPOSITION; }
    pf
}
