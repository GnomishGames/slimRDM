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

use ironrdp::connector::connection_activation::ConnectionActivationState;
use ironrdp::connector::{ClientConnector, Config, Credentials, DesktopSize, ServerName};
use ironrdp::session::{ActiveStage, ActiveStageBuilder, ActiveStageOutput};
use ironrdp::session::image::DecodedImage;
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::graphics::pointer::DecodedPointer;
use ironrdp::pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
use ironrdp::pdu::input::mouse::{MousePdu, PointerFlags};
use ironrdp::pdu::rdp::client_info::{PerformanceFlags, TimezoneInfo};
use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp::pdu::gcc::KeyboardType;
use ironrdp_tokio::{self as rdp_tokio, FramedWrite, TokioFramed};
use ironrdp_cliprdr::{Cliprdr, Client};
use ironrdp_cliprdr::pdu::{ClipboardFormat, ClipboardFormatId, FormatDataResponse};
use ironrdp_cliprdr::backend::CliprdrBackendFactory;

use crate::commands::egfx;
use crate::commands::legacy_tls;
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

/// A change to the remote cursor. The server never paints the pointer into the
/// framebuffer (`pointer_software_rendering: false`), so the shape it picks —
/// the resize arrows on a window border, the I-beam, the busy ring — only
/// reaches the user if these updates are forwarded and drawn by the frontend.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RdpCursorEvent {
    session_id: String,
    kind: &'static str, // "bitmap" | "default" | "hidden"
    width: u16,
    height: u16,
    hotspot_x: u16,
    hotspot_y: u16,
    data: String, // base64 raw RGBA, empty unless kind is "bitmap"
}

/// The cursor state the frontend has been told about, so an unchanged shape
/// isn't re-encoded and re-sent on every pointer PDU.
enum PointerState {
    Default,
    Hidden,
    Bitmap(Arc<DecodedPointer>),
}

impl PointerState {
    fn same_as(&self, other: &PointerState) -> bool {
        match (self, other) {
            (PointerState::Default, PointerState::Default) => true,
            (PointerState::Hidden, PointerState::Hidden) => true,
            // Repeat selections of a cached pointer hand back the same Arc.
            (PointerState::Bitmap(a), PointerState::Bitmap(b)) => Arc::ptr_eq(a, b),
            _ => false,
        }
    }
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

/// Which TLS stack a connection attempt upgrades the security layer with.
#[derive(Clone, Copy)]
enum TlsMode {
    /// rustls, as `ironrdp-tls` configures it: AEAD cipher suites only.
    Strict,
    /// The permissive stack in `legacy_tls`, for pre-2012 Schannel servers.
    Legacy,
}

/// Tagged so `run_rdp_session` can tell a refused TLS handshake — worth one
/// retry with the legacy stack — from every other way a session can end.
enum SessionFailure {
    TlsHandshake(String),
    Other(String),
}

impl SessionFailure {
    fn message(self) -> String {
        match self {
            Self::TlsHandshake(message) | Self::Other(message) => message,
        }
    }
}

impl From<String> for SessionFailure {
    fn from(message: String) -> Self {
        Self::Other(message)
    }
}

async fn run_rdp_session(
    app: &AppHandle,
    params: RdpConnectParams,
    mut input_rx: mpsc::UnboundedReceiver<SessionInput>,
) -> Result<(), String> {
    let session_id = params.session_id.clone();
    emit_status(app, &session_id, "connecting", None);

    // Read once: a refused TLS handshake says nothing about the credential, and
    // a second keyring lookup can prompt the user again or wait out its timeout.
    let password = match params.credential_ref.as_deref() {
        Some(ref_key) => crate::commands::credentials::get_credential_async(ref_key)
            .await
            .unwrap_or_else(|e| {
                log::warn!("[rdp {session_id}] credential fetch failed: {e}");
                String::new()
            }),
        None => String::new(),
    };

    match connect_attempt(app, &params, &mut input_rx, &password, TlsMode::Strict).await {
        Err(SessionFailure::TlsHandshake(message)) => {
            // A Schannel host with no AEAD cipher suite and a SHA-1 signed RDP
            // certificate leaves rustls nothing to negotiate, and the server
            // resets the socket. The failed handshake took the stream with it,
            // so the retry reconnects and redoes the X.224 negotiation.
            log::warn!("[rdp {session_id}] {message} — retrying with legacy TLS");

            // A disconnect requested during the handshake is still sitting in
            // the input queue, because nothing reads it until the session loop.
            // Drain it here rather than building a second connection to a pane
            // the user has already closed. The queue is the right question to
            // ask: the session registry is keyed by id alone, so a remounted
            // pane reusing this id would answer for a different attempt.
            let mut disconnected = false;
            while let Ok(input) = input_rx.try_recv() {
                if matches!(input, SessionInput::Disconnect) {
                    disconnected = true;
                }
            }
            if disconnected {
                return Ok(());
            }

            emit_status(
                app,
                &session_id,
                "connecting",
                Some("server refused modern TLS — retrying with legacy TLS".to_owned()),
            );
            connect_attempt(app, &params, &mut input_rx, &password, TlsMode::Legacy)
                .await
                .map_err(|failure| {
                    format!("{message} — legacy TLS retry also failed: {}", failure.message())
                })
        }
        result => result.map_err(SessionFailure::message),
    }
}

async fn connect_attempt(
    app: &AppHandle,
    params: &RdpConnectParams,
    input_rx: &mut mpsc::UnboundedReceiver<SessionInput>,
    password: &str,
    tls: TlsMode,
) -> Result<(), SessionFailure> {
    if let Some(ref jump) = params.jump_host_params {
        let stream = open_jump_channel(jump, &params.host, params.port)
            .await
            .map_err(|e| format!("Jump host error: {e}"))?;
        let client_addr: std::net::SocketAddr = "127.0.0.1:0".parse().unwrap();
        run_rdp_inner(app, params, input_rx, password, stream, client_addr, tls).await
    } else {
        let tcp = TcpStream::connect(format!("{}:{}", params.host, params.port))
            .await
            .map_err(|e| format!("TCP connect failed: {e}"))?;
        let client_addr = tcp.local_addr().map_err(|e| e.to_string())?;
        run_rdp_inner(app, params, input_rx, password, tcp, client_addr, tls).await
    }
}

async fn run_rdp_inner<S>(
    app: &AppHandle,
    params: &RdpConnectParams,
    input_rx: &mut mpsc::UnboundedReceiver<SessionInput>,
    password: &str,
    stream: S,
    client_addr: std::net::SocketAddr,
    tls: TlsMode,
) -> Result<(), SessionFailure>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
{
    let session_id = params.session_id.clone();

    let width = params.width.unwrap_or(1280) as u16;
    let height = params.height.unwrap_or(800) as u16;

    let config = Config {
        credentials: Credentials::UsernamePassword {
            username: params.username.clone(),
            password: password.to_owned(),
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
        alternate_shell: String::new(),
        work_dir: String::new(),
        // Bulk compression stays off, as it was before the 0.17 upgrade.
        compression_type: None,
        multitransport_flags: None,
    };

    let mut framed = TokioFramed::new(stream);
    let connector = ClientConnector::new(config, client_addr);

    let clipboard_factory = TauriCliprdrBackendFactory::new(app.clone(), params.session_id.clone());
    let cliprdr: Cliprdr<ironrdp_cliprdr::Client> = Cliprdr::new(clipboard_factory.build_cliprdr_backend());

    // The graphics pipeline is the only way some hosts paint at all. No H.264
    // decoder is supplied, so the AVC capability sets are filtered out and the
    // server falls back to ClearCodec and Progressive, which decode in-crate.
    let egfx_updates = crate::commands::egfx::SurfaceUpdates::default();
    let graphics = ironrdp_egfx::client::GraphicsPipelineClient::new(
        Box::new(crate::commands::egfx::Handler::new(
            egfx_updates.clone(),
            params.session_id.clone(),
        )),
        None,
    );
    let drdynvc = ironrdp_dvc::DrdynvcClient::new().with_dynamic_channel(graphics);

    let mut connector = connector
        .with_static_channel(cliprdr)
        .with_static_channel(drdynvc);

    let should_upgrade = rdp_tokio::connect_begin(&mut framed, &mut connector)
        .await
        .map_err(|e| format!("Negotiation failed: {e}"))?;

    let raw_stream = framed.into_inner_no_leftover();

    // The arms differ only in the TLS stack underneath the session.
    match tls {
        TlsMode::Strict => {
            let (tls_stream, tls_cert) = ironrdp_tls::upgrade(raw_stream, &params.host)
                .await
                .map_err(|e| {
                    let message = format!("TLS upgrade failed: {e}");
                    if is_handshake_refusal(&e) {
                        SessionFailure::TlsHandshake(message)
                    } else {
                        SessionFailure::Other(message)
                    }
                })?;
            finish(app, params, input_rx, connector, should_upgrade, tls_stream, &tls_cert, egfx_updates).await
        }
        TlsMode::Legacy => {
            let (tls_stream, tls_cert) = legacy_tls::upgrade(raw_stream, &params.host)
                .await
                .map_err(|e| SessionFailure::Other(format!("Legacy TLS upgrade failed: {e}")))?;
            log::warn!(
                "[rdp {session_id}] upgraded with legacy TLS — {} refuses modern cipher suites",
                params.host,
            );
            finish(app, params, input_rx, connector, should_upgrade, tls_stream, &tls_cert, egfx_updates).await
        }
    }
}

/// Mark the security upgrade as done and hand the stream to the session. Shared
/// by both TLS stacks, which differ only in the stream type they produce.
#[allow(clippy::too_many_arguments)]
async fn finish<U>(
    app: &AppHandle,
    params: &RdpConnectParams,
    input_rx: &mut mpsc::UnboundedReceiver<SessionInput>,
    mut connector: ClientConnector,
    should_upgrade: rdp_tokio::ShouldUpgrade,
    tls_stream: U,
    tls_cert: &x509_cert::Certificate,
    egfx_updates: crate::commands::egfx::SurfaceUpdates,
) -> Result<(), SessionFailure>
where
    U: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
{
    let public_key = extract_server_public_key(tls_cert)?;
    let upgraded = rdp_tokio::mark_as_upgraded(should_upgrade, &mut connector);
    run_session(app, params, input_rx, connector, upgraded, tls_stream, public_key, egfx_updates).await
}

/// Whether a failed handshake looks like the server refusing what was offered,
/// rather than the connection breaking underneath it. A server with no cipher
/// suite in common drops the socket — `spftp` sends a reset, others close
/// without a word — or sends an alert that rustls surfaces as invalid data. A
/// timeout or an unreachable route is not worth a second full connection.
pub(crate) fn is_handshake_refusal(error: &std::io::Error) -> bool {
    use std::io::ErrorKind;

    matches!(
        error.kind(),
        ErrorKind::ConnectionReset
            | ErrorKind::ConnectionAborted
            | ErrorKind::UnexpectedEof
            | ErrorKind::InvalidData
    )
}

/// Read a rectangle out of the framebuffer, clipped to the surface.
///
/// Returns the width actually read alongside the pixels, because a rectangle
/// overhanging the right edge yields a narrower copy.
fn read_rect(fb: &[u8], stride: usize, x: u16, y: u16, width: u16, height: u16) -> (u16, Vec<u8>) {
    let surface_width = stride / 4;
    let visible = usize::from(width).min(surface_width.saturating_sub(usize::from(x)));
    let row_len = visible * 4;
    let mut pixels = Vec::with_capacity(row_len * usize::from(height));

    for row in 0..usize::from(height) {
        let start = (usize::from(y) + row) * stride + usize::from(x) * 4;
        if row_len > 0 && start + row_len <= fb.len() {
            pixels.extend_from_slice(&fb[start..start + row_len]);
        }
    }

    (u16::try_from(visible).unwrap_or(width), pixels)
}

/// Copy an RGBA rectangle into the framebuffer, clipped to the surface.
///
/// Clipping has to be per row against the surface width, not against the
/// buffer length: a rectangle that overhangs the right edge would otherwise
/// copy straight past the end of its row and into the left edge of the next
/// one. Graphics-pipeline tiles are always 64 wide, so every tile in the
/// right-hand column overhangs a surface whose width is not a multiple of 64.
fn blit(fb: &mut [u8], stride: usize, x: u16, y: u16, width: u16, height: u16, rgba: &[u8]) {
    let surface_width = stride / 4;
    let x = x as usize;
    let y = y as usize;
    if x >= surface_width {
        return;
    }

    let visible = (width as usize).min(surface_width - x);
    let src_row_len = width as usize * 4;
    let copy_len = visible * 4;

    for row in 0..height as usize {
        let src = row * src_row_len;
        let dst = (y + row) * stride + x * 4;
        if dst + copy_len <= fb.len() && src + copy_len <= rgba.len() {
            fb[dst..dst + copy_len].copy_from_slice(&rgba[src..src + copy_len]);
        }
    }
}

fn extract_server_public_key(cert: &x509_cert::Certificate) -> Result<Vec<u8>, SessionFailure> {
    ironrdp_tls::extract_tls_server_public_key(cert)
        .map(<[u8]>::to_vec)
        .ok_or_else(|| SessionFailure::Other("Failed to extract server public key".to_owned()))
}

/// Finish CredSSP authentication over the upgraded stream and run the session
/// until it disconnects. Generic over the stream so both TLS stacks share it.
#[allow(clippy::too_many_arguments)]
async fn run_session<U>(
    app: &AppHandle,
    params: &RdpConnectParams,
    input_rx: &mut mpsc::UnboundedReceiver<SessionInput>,
    connector: ClientConnector,
    upgraded: rdp_tokio::Upgraded,
    tls_stream: U,
    server_public_key: Vec<u8>,
    egfx_updates: crate::commands::egfx::SurfaceUpdates,
) -> Result<(), SessionFailure>
where
    U: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
{
    let session_id = params.session_id.clone();
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

    log::debug!(
        "[rdp {session_id}] connected: desktop {}x{}",
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );
    emit_status(app, &session_id, "connected", None);

    // Kept for the Deactivation-Reactivation Sequence below; the MCS channel ids
    // it carries are invariant for the life of the connection.
    let activation_factory = connection_result.activation_factory;

    let (mut reader, mut writer) = rdp_tokio::split_tokio_framed(upgraded_framed);
    let mut image = DecodedImage::new(
        PixelFormat::RgbA32,
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );
    let mut active_stage = ActiveStageBuilder {
        static_channels: connection_result.static_channels,
        user_channel_id: connection_result.user_channel_id,
        io_channel_id: connection_result.io_channel_id,
        message_channel_id: connection_result.message_channel_id,
        share_id: connection_result.share_id,
        compression_type: connection_result.compression_type,
        enable_server_pointer: connection_result.enable_server_pointer,
        pointer_software_rendering: connection_result.pointer_software_rendering,
    }
    .build();
    let frame_budget = match params.connection_quality.as_deref() {
        Some("lan")       => Duration::from_millis(8),   // ~120fps
        Some("broadband") => Duration::from_millis(33),  // ~30fps
        Some("modem")     => Duration::from_millis(100), // ~10fps
        _                 => Duration::from_millis(16),  // ~60fps (auto/default)
    };
    let mut last_frame = Instant::now();
    // Graphics pipeline hosts paint here instead of into `image`, which exposes
    // no mutable data. Allocated on the first update, so legacy servers pay
    // nothing for it.
    let mut egfx_fb: Option<Vec<u8>> = None;
    // Regions the server stored for repeated blitting: slot -> (w, h, RGBA).
    let mut egfx_cache: HashMap<u16, (u16, u16, Vec<u8>)> = HashMap::new();
    let mut egfx_cache_misses: u32 = 0;
    // Union of all dirty regions not yet emitted. Carried across loop iterations
    // so updates are never dropped when the frame timer isn't ready.
    let mut pending_dirty: Option<(u16, u16, u16, u16)> = None; // (left, top, right, bottom)
    // Cursor shape the frontend is currently showing.
    let mut last_pointer: Option<PointerState> = None;

    loop {
        let (outputs, resize_bytes) = tokio::select! {
            frame = reader.read_pdu() => {
                let (action, payload) = frame.map_err(|e| format!("Read error: {e}"))?;
                let outputs = active_stage.process(&mut image, action, &payload)
                    .map_err(|e| format!("Session error: {e}"))?;

                // The graphics pipeline decodes inside `process`, so anything it
                // produced is waiting now.
                for op in egfx_updates.drain() {
                    let stride = image.width() as usize * 4;
                    let fb = egfx_fb.get_or_insert_with(|| {
                        vec![0u8; stride * image.height() as usize]
                    });

                    // Each operation reports the rectangles it touched, so the
                    // dirty union and frame pacing stay shared with the legacy
                    // path.
                    let mut touched: Vec<(u16, u16, u16, u16)> = Vec::new();

                    match op {
                        egfx::SurfaceOp::Bitmap { x, y, width, height, rgba } => {
                            blit(fb, stride, x, y, width, height, &rgba);
                            touched.push((x, y, width, height));
                        }
                        egfx::SurfaceOp::Fill { rgba, rects } => {
                            let surface_width = stride / 4;
                            for (x, y, width, height) in rects {
                                if x as usize >= surface_width {
                                    continue;
                                }
                                let visible = (width as usize).min(surface_width - x as usize);
                                for row in 0..height as usize {
                                    let start = (y as usize + row) * stride + x as usize * 4;
                                    let end = start + visible * 4;
                                    if end <= fb.len() {
                                        let (pixels, _) = fb[start..end].as_chunks_mut::<4>();
                                        for px in pixels {
                                            px.copy_from_slice(&rgba);
                                        }
                                    }
                                }
                                touched.push((x, y, width, height));
                            }
                        }
                        egfx::SurfaceOp::ToCache { slot, x, y, width, height } => {
                            let (stored_width, pixels) = read_rect(fb, stride, x, y, width, height);
                            egfx_cache.insert(slot, (stored_width, height, pixels));
                        }
                        egfx::SurfaceOp::EvictCache { slot } => {
                            // The server has told us it will not reference this
                            // slot again; holding the copy wastes memory.
                            egfx_cache.remove(&slot);
                        }
                        egfx::SurfaceOp::Copy { x, y, width, height, points } => {
                            // Read the source out first: destinations may overlap it.
                            let (copied_width, pixels) = read_rect(fb, stride, x, y, width, height);
                            for (dx, dy) in points {
                                blit(fb, stride, dx, dy, copied_width, height, &pixels);
                                touched.push((dx, dy, copied_width, height));
                            }
                        }
                        egfx::SurfaceOp::FromCache { slot, points } => {
                            match egfx_cache.get(&slot) {
                                Some((width, height, pixels)) => {
                                    for (x, y) in points {
                                        blit(fb, stride, x, y, *width, *height, pixels);
                                        touched.push((x, y, *width, *height));
                                    }
                                }
                                None => {
                                    // A blit from a slot we never stored leaves
                                    // the framebuffer untouched where content
                                    // belongs, so it is worth knowing about.
                                    egfx_cache_misses += 1;
                                    if egfx_cache_misses == 1 {
                                        log::debug!(
                                            "[rdp {session_id}] egfx cache slot {slot} blitted before it was stored",
                                        );
                                    }
                                }
                            }
                        }
                    }

                    for (x, y, width, height) in touched {
                        if width == 0 || height == 0 {
                            continue;
                        }
                        let region = (
                            x,
                            y,
                            x.saturating_add(width).saturating_sub(1),
                            y.saturating_add(height).saturating_sub(1),
                        );
                        pending_dirty = Some(match pending_dirty {
                            None => region,
                            Some((l, t, r, b)) => (
                                l.min(region.0),
                                t.min(region.1),
                                r.max(region.2),
                                b.max(region.3),
                            ),
                        });
                    }
                }

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
        let mut reactivate = false;
        // Newest cursor state in the batch wins. Selecting a cached pointer
        // emits PointerHidden immediately followed by PointerBitmap, and
        // applying both would blink the cursor off between shapes.
        let mut pointer_update: Option<PointerState> = None;
        for output in outputs {
            match output {
                ActiveStageOutput::ResponseFrame(frame) => {
                    writer.write_all(&frame).await.map_err(|e| format!("Write error: {e}"))?;
                }
                ActiveStageOutput::PointerBitmap(pointer) => {
                    // ironrdp decodes a 0x0 pointer attribute into its
                    // `new_invisible()` pointer — the server hiding the cursor
                    // through the bitmap path. Forwarding that as a bitmap
                    // would leave the frontend with nothing to draw, and the
                    // PointerHidden that precedes it is coalesced away here.
                    pointer_update = Some(if pointer.width == 0 || pointer.height == 0 {
                        PointerState::Hidden
                    } else {
                        PointerState::Bitmap(pointer)
                    });
                }
                ActiveStageOutput::PointerDefault => {
                    pointer_update = Some(PointerState::Default);
                }
                ActiveStageOutput::PointerHidden => {
                    pointer_update = Some(PointerState::Hidden);
                }
                // The server asking to warp the pointer. A webview can't move
                // the host cursor, and honouring it by moving the drawn cursor
                // alone would just put it somewhere the real mouse isn't.
                ActiveStageOutput::PointerPosition { .. } => {}
                ActiveStageOutput::GraphicsUpdate(region) => {
                    // Frames are emitted from one buffer, and the graphics
                    // pipeline's takes over as soon as it exists. A host that
                    // paints through both paths would otherwise have its
                    // legacy updates read out of a buffer nothing wrote them
                    // to, so copy the region across.
                    if let Some(fb) = egfx_fb.as_deref_mut() {
                        let stride = usize::from(image.width()) * 4;
                        let width = region.right.saturating_sub(region.left) + 1;
                        let height = region.bottom.saturating_sub(region.top) + 1;
                        let row_len = usize::from(width) * 4;
                        let src = image.data();
                        for row in 0..usize::from(height) {
                            let offset =
                                (usize::from(region.top) + row) * stride + usize::from(region.left) * 4;
                            if offset + row_len <= fb.len() && offset + row_len <= src.len() {
                                fb[offset..offset + row_len]
                                    .copy_from_slice(&src[offset..offset + row_len]);
                            }
                        }
                    }

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
                // The server tore the activation down — it does this when a
                // client reconnects to a session that already exists. Until the
                // capability exchange is redone it sends no graphics at all, so
                // ignoring this leaves a live session on a frozen canvas.
                ActiveStageOutput::DeactivateAll => { reactivate = true; }
                _ => {}
            }
        }

        if let Some(state) = pointer_update {
            let unchanged = last_pointer.as_ref().is_some_and(|prev| prev.same_as(&state));
            if !unchanged {
                let event = cursor_event(&session_id, &state);
                log::debug!(
                    "[rdp {}] cursor {} {}x{} hotspot {},{}",
                    session_id, event.kind, event.width, event.height,
                    event.hotspot_x, event.hotspot_y,
                );
                let _ = app.emit("rdp-cursor", event);
                last_pointer = Some(state);
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
                // Clamp to the surface: a dirty rectangle can overhang, and
                // reading a row past its end would splice in pixels from the
                // start of the next one.
                let x = usize::from(left).min(usize::from(image.width()).saturating_sub(1));
                let y = usize::from(top).min(usize::from(image.height()).saturating_sub(1));
                let w = usize::from(right.saturating_sub(left) + 1)
                    .min(usize::from(image.width()) - x);
                let h = usize::from(bottom.saturating_sub(top) + 1)
                    .min(usize::from(image.height()) - y);
                let stride = image.width() as usize * 4;
                let src: &[u8] = match egfx_fb.as_deref() {
                    Some(fb) => fb,
                    None => image.data(),
                };
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
                    // The clamped origin, matching where the pixels were read
                    // from — an op can report a rectangle that overhangs.
                    x: u16::try_from(x).unwrap_or(left),
                    y: u16::try_from(y).unwrap_or(top),
                    width: w as u16,
                    height: h as u16,
                    full_width: image.width(),
                    full_height: image.height(),
                    data: BASE64.encode(&pixels),
                });
            }
        }

        if reactivate {
            log::debug!("[rdp {session_id}] server deactivated the session; reactivating");

            let mut framed = rdp_tokio::unsplit_tokio_framed(reader, writer);
            let mut sequence = activation_factory.create();
            let mut buf = ironrdp::core::WriteBuf::new();
            while !ironrdp::connector::Sequence::state(&sequence).is_terminal() {
                rdp_tokio::single_sequence_step(&mut framed, &mut sequence, &mut buf)
                    .await
                    .map_err(|e| format!("Reactivation failed: {e}"))?;
            }

            if let ConnectionActivationState::Finalized {
                desktop_size,
                share_id,
                enable_server_pointer,
                ..
            } = sequence.connection_activation_state()
            {
                // The desktop may come back a different size, so the framebuffers
                // and the fast-path decoder have to follow it.
                image = DecodedImage::new(PixelFormat::RgbA32, desktop_size.width, desktop_size.height);
                egfx_fb = None;
                // Cached regions were captured from the framebuffer that just
                // went away, and may not even match the new geometry.
                egfx_cache.clear();
                pending_dirty = None;
                active_stage.set_share_id(share_id);
                active_stage.set_enable_server_pointer(enable_server_pointer);
                log::debug!(
                    "[rdp {session_id}] reactivated: desktop {}x{}",
                    desktop_size.width,
                    desktop_size.height,
                );
            }

            let halves = rdp_tokio::split_tokio_framed(framed);
            reader = halves.0;
            writer = halves.1;
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

fn cursor_event(session_id: &str, state: &PointerState) -> RdpCursorEvent {
    let (kind, width, height, hotspot_x, hotspot_y, data) = match state {
        PointerState::Default => ("default", 0, 0, 0, 0, String::new()),
        PointerState::Hidden => ("hidden", 0, 0, 0, 0, String::new()),
        PointerState::Bitmap(p) => (
            "bitmap",
            p.width,
            p.height,
            p.hotspot_x,
            p.hotspot_y,
            BASE64.encode(&p.bitmap_data),
        ),
    };
    RdpCursorEvent {
        session_id: session_id.to_string(),
        kind,
        width,
        height,
        hotspot_x,
        hotspot_y,
        data,
    }
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

// Input forwarding is deliberately synchronous: these are plain channel sends
// with nothing to await, and an `async` command would be spawned as its own
// task, losing the order the frontend emitted the events in. Order matters —
// a modifier press must reach the server before the key or click it modifies.
#[tauri::command]
pub fn rdp_mouse_event(session_id: String, flags: u16, x: u16, y: u16, wheel_units: i16) -> Result<(), String> {
    send_input(&session_id, SessionInput::MouseEvent { flags, x, y, wheel_units })
}

#[tauri::command]
pub fn rdp_key_event(session_id: String, flags: u8, scancode: u8) -> Result<(), String> {
    send_input(&session_id, SessionInput::KeyEvent { flags, scancode })
}

#[tauri::command]
pub fn rdp_type_text(session_id: String, text: String) -> Result<(), String> {
    let chars: Vec<u16> = text.encode_utf16().collect();
    send_input(&session_id, SessionInput::UnicodeText(chars))
}

#[tauri::command]
pub fn rdp_resize(session_id: String, width: u16, height: u16) -> Result<(), String> {
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
    if !flags.disable_font_smoothing { pf |= PerformanceFlags::ENABLE_FONT_SMOOTHING; }
    if flags.disable_menu_animations { pf |= PerformanceFlags::DISABLE_MENUANIMATIONS; }
    if flags.disable_theme { pf |= PerformanceFlags::DISABLE_THEMING; }
    // DISABLE_CURSORSETTINGS covers both cursor shadow and blinking
    if flags.disable_cursor_shadow || flags.disable_cursor_blinking { pf |= PerformanceFlags::DISABLE_CURSORSETTINGS; }
    if flags.enable_desktop_composition { pf |= PerformanceFlags::ENABLE_DESKTOP_COMPOSITION; }
    pf
}

#[cfg(test)]
mod tests {
    use std::io::{Error, ErrorKind};

    use super::is_handshake_refusal;

    #[test]
    fn refusal_covers_how_servers_actually_reject_us() {
        // A server with no suite in common drops the socket rather than sending
        // an alert; tokio-rustls surfaces a rejection alert as invalid data.
        for kind in [
            ErrorKind::ConnectionReset,
            ErrorKind::ConnectionAborted,
            ErrorKind::UnexpectedEof,
            ErrorKind::InvalidData,
        ] {
            assert!(is_handshake_refusal(&Error::new(kind, "x")), "{kind:?} should retry");
        }
    }

    #[test]
    fn unrelated_failures_do_not_open_a_second_connection() {
        for kind in [
            ErrorKind::TimedOut,
            ErrorKind::PermissionDenied,
            ErrorKind::AddrNotAvailable,
            ErrorKind::Other,
        ] {
            assert!(!is_handshake_refusal(&Error::new(kind, "x")), "{kind:?} should not retry");
        }
    }
}
