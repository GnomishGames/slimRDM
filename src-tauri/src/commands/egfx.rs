//! Graphics pipeline (MS-RDPEGFX) surface updates.
//!
//! Hosts running the WDDM RDP display driver paint *only* through the
//! `Microsoft::Windows::RDS::Graphics` dynamic virtual channel. They still
//! advertise the legacy bitmap codecs, but never produce them, so a client
//! without this channel gets a healthy, logged-on session — clipboard and all —
//! on a permanently blank canvas.
//!
//! The channel owns the handler, so updates reach the session loop through the
//! shared sink below. They arrive while `ActiveStage::process` is running, which
//! is why the loop drains immediately afterwards.

use std::sync::{Arc, Mutex};

use ironrdp::graphics::clearcodec::ClearCodecDecoder;
use ironrdp_egfx::client::{BitmapUpdate, GraphicsPipelineHandler};
use ironrdp_egfx::pdu::{Codec1Type, GfxPdu};

/// A graphics operation to apply to the framebuffer, in its coordinate space.
///
/// The pipeline paints with more than bitmaps: large uniform areas arrive as
/// fills, and repeated content (taskbars, window chrome) is stored once and
/// blitted back. All of these touch the framebuffer, which the handler has no
/// access to, so they are queued and applied by the session loop.
pub enum SurfaceOp {
    /// Decoded pixels for a rectangle.
    Bitmap {
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        /// RGBA, 4 bytes per pixel, row-major, `width * height * 4` long.
        /// `ironrdp-egfx` converts the wire's BGRX to RGBA before handing it over.
        rgba: Vec<u8>,
    },
    /// Fill rectangles with one colour. Each rect is `(x, y, width, height)`.
    Fill { rgba: [u8; 4], rects: Vec<(u16, u16, u16, u16)> },
    /// Copy a framebuffer region into a cache slot.
    ToCache { slot: u16, x: u16, y: u16, width: u16, height: u16 },
    /// Blit a cached region back to each destination point.
    FromCache { slot: u16, points: Vec<(u16, u16)> },
}

/// Shared hand-off from the channel to the session loop.
#[derive(Clone, Default)]
pub struct SurfaceUpdates(Arc<Mutex<Vec<SurfaceOp>>>);

impl SurfaceUpdates {
    pub fn push(&self, op: SurfaceOp) {
        self.0.lock().unwrap().push(op);
    }

    /// Take everything received since the last call.
    pub fn drain(&self) -> Vec<SurfaceOp> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

pub struct Handler {
    updates: SurfaceUpdates,
    session_id: String,
    /// ClearCodec keeps glyph and v-bar caches across frames, so one decoder
    /// has to live for the whole session.
    clear: ClearCodecDecoder,
    /// Codecs seen that we cannot decode, logged once each rather than per PDU.
    unsupported_logged: Vec<String>,
    decoded: u32,
    failed: u32,
    ops: IgnoredOps,
}

/// Counts of graphics operations that currently go unhandled.
#[derive(Default)]
struct IgnoredOps {
    surface_to_surface: u32,
    progressive: u32,
}

impl Handler {
    pub fn new(updates: SurfaceUpdates, session_id: String) -> Self {
        Self {
            updates,
            session_id,
            clear: ClearCodecDecoder::new(),
            unsupported_logged: Vec::new(),
            decoded: 0,
            failed: 0,
            ops: IgnoredOps::default(),
        }
    }
}

impl GraphicsPipelineHandler for Handler {
    fn on_bitmap_updated(&mut self, update: &BitmapUpdate) {
        // Empty data means the decode was skipped — an AVC frame with no H.264
        // decoder configured. Drawing it would paint a black rectangle over
        // whatever is already there.
        if update.data.is_empty() {
            return;
        }

        self.updates.push(SurfaceOp::Bitmap {
            x: update.destination_rectangle.left,
            y: update.destination_rectangle.top,
            width: update.width,
            height: update.height,
            rgba: update.data.clone(),
        });
    }

    /// `ironrdp-egfx` decodes only AVC and uncompressed bitmaps; everything else
    /// is handed over whole, `bitmap_data` included. ClearCodec is the codec
    /// Windows paints desktops with, and `ironrdp-graphics` can decode it — it
    /// is simply not wired into the EGFX client.
    fn on_unhandled_pdu(&mut self, pdu: &GfxPdu) {
        let GfxPdu::WireToSurface1(pdu) = pdu else {
            return;
        };

        if pdu.codec_id != Codec1Type::ClearCodec {
            let name = format!("{:?}", pdu.codec_id);
            if !self.unsupported_logged.contains(&name) {
                log::warn!(
                    "[rdp {}] egfx codec {name} is not decoded; those regions stay unpainted",
                    self.session_id,
                );
                self.unsupported_logged.push(name);
            }
            return;
        }

        let rect = &pdu.destination_rectangle;
        let width = rect.right.saturating_sub(rect.left);
        let height = rect.bottom.saturating_sub(rect.top);
        if width == 0 || height == 0 {
            return;
        }

        let mut bgra = match self.clear.decode(&pdu.bitmap_data, width, height) {
            Ok(pixels) => {
                self.decoded += 1;
                pixels
            }
            Err(e) => {
                self.failed += 1;
                // Every failure is a region left unpainted, so report the first
                // few with their shape rather than flooding the log.
                if self.failed <= 3 {
                    // Every failure is a region left unpainted, so report the
                    // first few with their shape rather than flooding the log.
                    log::warn!(
                        "[rdp {}] clearcodec decode failed ({width}x{height}, {} bytes): {e}",
                        self.session_id,
                        pdu.bitmap_data.len(),
                    );
                }
                return;
            }
        };

        // The decoder emits BGRA; the framebuffer and the canvas are RGBA.
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
        }

        self.updates.push(SurfaceOp::Bitmap {
            x: rect.left,
            y: rect.top,
            width,
            height,
            rgba: bgra,
        });
    }

    fn on_reset_graphics(&mut self, width: u32, height: u32) {
        log::debug!("[rdp {}] egfx reset graphics {width}x{height}", self.session_id);
    }

    // TEMPORARY: these all have default no-op implementations, so anything the
    // server paints through them disappears without trace. Count them to find
    // out which ones this host actually uses before implementing any.
    fn on_solid_fill(&mut self, pdu: &ironrdp_egfx::pdu::SolidFillPdu) {
        let c = &pdu.fill_pixel;
        let rects = pdu
            .rectangles
            .iter()
            .map(|r| {
                (
                    r.left,
                    r.top,
                    r.right.saturating_sub(r.left),
                    r.bottom.saturating_sub(r.top),
                )
            })
            .collect();

        // `xa` is the alpha byte; surfaces are opaque, so it is forced.
        self.updates.push(SurfaceOp::Fill {
            rgba: [c.r, c.g, c.b, 0xFF],
            rects,
        });
    }

    fn on_surface_to_surface(&mut self, _pdu: &ironrdp_egfx::pdu::SurfaceToSurfacePdu) {
        self.ops.surface_to_surface += 1;
        if self.ops.surface_to_surface == 1 {
            log::warn!("[rdp {}] egfx SurfaceToSurface is not applied", self.session_id);
        }
    }

    fn on_surface_to_cache(&mut self, pdu: &ironrdp_egfx::pdu::SurfaceToCachePdu) {
        let r = &pdu.source_rectangle;
        self.updates.push(SurfaceOp::ToCache {
            slot: pdu.cache_slot,
            x: r.left,
            y: r.top,
            width: r.right.saturating_sub(r.left),
            height: r.bottom.saturating_sub(r.top),
        });
    }

    fn on_cache_to_surface(&mut self, pdu: &ironrdp_egfx::pdu::CacheToSurfacePdu) {
        self.updates.push(SurfaceOp::FromCache {
            slot: pdu.cache_slot,
            points: pdu.destination_points.iter().map(|p| (p.x, p.y)).collect(),
        });
    }

    fn on_wire_to_surface2(&mut self, _pdu: &ironrdp_egfx::pdu::WireToSurface2Pdu) {
        self.ops.progressive += 1;
        if self.ops.progressive == 1 {
            log::warn!("[rdp {}] egfx RFX Progressive is not decoded", self.session_id);
        }
    }

    fn on_close(&mut self) {
        log::debug!(
            "[rdp {}] egfx closed; clearcodec decoded {} failed {}; unhandled: \
             surface_to_surface {} progressive {}",
            self.session_id,
            self.decoded,
            self.failed,
            self.ops.surface_to_surface,
            self.ops.progressive,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drain_returns_updates_in_order_and_empties_the_sink() {
        let sink = SurfaceUpdates::default();
        sink.push(SurfaceOp::Bitmap { x: 1, y: 2, width: 3, height: 4, rgba: vec![0; 48] });
        sink.push(SurfaceOp::Fill { rgba: [1, 2, 3, 4], rects: vec![(5, 6, 1, 1)] });

        let drained = sink.drain();

        assert_eq!(drained.len(), 2);
        assert!(matches!(drained[0], SurfaceOp::Bitmap { x: 1, y: 2, .. }));
        assert!(matches!(drained[1], SurfaceOp::Fill { .. }));
        assert!(sink.drain().is_empty(), "drain must empty the sink");
    }

    /// Captured from a real session against a Windows host that paints with
    /// ClearCodec. 44x64 region: one RLEX segment whose run covers 2815 pixels,
    /// plus the segment's own suite pixel, is exactly 2816 = 44 * 64.
    const CLEARCODEC_44X64: &[u8] = &[
        0x00, 0x00, // glyphFlags, seqNumber
        0x00, 0x00, 0x00, 0x00, // residualByteCount
        0x00, 0x00, 0x00, 0x00, // bandsByteCount
        0x15, 0x00, 0x00, 0x00, // subcodecByteCount = 21
        0x00, 0x00, 0x00, 0x00, // xStart, yStart
        0x2c, 0x00, 0x40, 0x00, // width 44, height 64
        0x08, 0x00, 0x00, 0x00, // bitmapDataByteCount = 8
        0x02, // subcodecId = RLEX
        0x01, // paletteCount = 1
        0x00, 0x00, 0x00, // palette entry (BGR black)
        0x00, // packed stopIndex/suiteDepth
        0xff, 0xff, 0x0a, // runLengthFactor1 = 0xff -> factor2 = 2815
    ];

    #[test]
    fn decodes_a_single_palette_clearcodec_region() {
        let mut decoder = ClearCodecDecoder::new();

        let pixels = decoder
            .decode(CLEARCODEC_44X64, 44, 64)
            .expect("a single-entry palette still carries a packed stop/suite byte");

        assert_eq!(pixels.len(), 44 * 64 * 4);
    }

    /// Captured from the same host: one band of short-V-bar cache misses, each
    /// covering the band's full nine rows. The three full cache hits that
    /// followed in the live stream are dropped, because they reference entries
    /// an earlier update had populated.
    ///
    /// The bands layer consumes to the byte only when shortVBarYOn is read from
    /// the low eight bits and shortVBarYOff from bits 13:8. Read the other way
    /// round it fails on the first V-bar of the first band, and the whole
    /// region is left unpainted.
    const CLEARCODEC_BANDS: &[u8] = &[
        0x01, 0x0a, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9c, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x08, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x09, 0x40, 0x19, 0x00, 0x48, 0x23, 0x0b, 0x90,
        0x7a, 0x6b, 0x96, 0x81, 0x73, 0x4e, 0x2a, 0x13, 0x40, 0x19, 0x00, 0x40,
        0x19, 0x00, 0x40, 0x19, 0x00, 0x40, 0x19, 0x00, 0x00, 0x09, 0x40, 0x19,
        0x00, 0xd5, 0xcc, 0xc7, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe1, 0xdb,
        0xd7, 0x40, 0x19, 0x00, 0x40, 0x19, 0x00, 0x40, 0x19, 0x00, 0x40, 0x19,
        0x00, 0x00, 0x09, 0x40, 0x19, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x6f, 0x52, 0x3f, 0x40, 0x19, 0x00,
        0x40, 0x19, 0x00, 0x40, 0x19, 0x00, 0x00, 0x09, 0x4b, 0x27, 0x0f, 0xff,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x5d,
        0x3c, 0x27, 0x40, 0x19, 0x00, 0x40, 0x19, 0x00, 0x40, 0x19, 0x00, 0x00,
        0x09, 0x40, 0x19, 0x00, 0x84, 0x6b, 0x5b, 0xf0, 0xed, 0xeb, 0xf6, 0xf4,
        0xf3, 0x90, 0x7a, 0x6b, 0x40, 0x19, 0x00, 0x40, 0x19, 0x00, 0x40, 0x19,
        0x00, 0x40, 0x19, 0x00,
    ];

    #[test]
    fn decodes_a_band_of_short_vbars() {
        let mut decoder = ClearCodecDecoder::new();

        let pixels = decoder
            .decode(CLEARCODEC_BANDS, 5, 9)
            .expect("short V-bar cache misses pack yOn in the low byte");

        assert_eq!(pixels.len(), 5 * 9 * 4);
    }

    #[test]
    fn a_clone_shares_one_sink() {
        // The channel holds one clone and the session loop another; they have to
        // be the same queue or every update is dropped.
        let sink = SurfaceUpdates::default();
        let channel_side = sink.clone();
        channel_side.push(SurfaceOp::Bitmap { x: 0, y: 0, width: 1, height: 1, rgba: vec![1, 2, 3, 4] });

        assert_eq!(sink.drain().len(), 1);
    }
}
