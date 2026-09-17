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

/// One decoded rectangle, in the framebuffer's coordinate space.
pub struct SurfaceUpdate {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    /// RGBA, 4 bytes per pixel, row-major, `width * height * 4` long.
    /// `ironrdp-egfx` converts the wire's BGRX to RGBA before handing it over.
    pub rgba: Vec<u8>,
}

/// Shared hand-off from the channel to the session loop.
#[derive(Clone, Default)]
pub struct SurfaceUpdates(Arc<Mutex<Vec<SurfaceUpdate>>>);

impl SurfaceUpdates {
    pub fn push(&self, update: SurfaceUpdate) {
        self.0.lock().unwrap().push(update);
    }

    /// Take everything received since the last call.
    pub fn drain(&self) -> Vec<SurfaceUpdate> {
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

        self.updates.push(SurfaceUpdate {
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

        self.updates.push(SurfaceUpdate {
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

    fn on_close(&mut self) {
        log::debug!(
            "[rdp {}] egfx channel closed; clearcodec decoded {} failed {}",
            self.session_id,
            self.decoded,
            self.failed,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drain_returns_updates_in_order_and_empties_the_sink() {
        let sink = SurfaceUpdates::default();
        sink.push(SurfaceUpdate { x: 1, y: 2, width: 3, height: 4, rgba: vec![0; 48] });
        sink.push(SurfaceUpdate { x: 5, y: 6, width: 1, height: 1, rgba: vec![9; 4] });

        let drained = sink.drain();

        assert_eq!(drained.len(), 2);
        assert_eq!((drained[0].x, drained[0].y), (1, 2));
        assert_eq!((drained[1].x, drained[1].y), (5, 6));
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

    #[test]
    fn a_clone_shares_one_sink() {
        // The channel holds one clone and the session loop another; they have to
        // be the same queue or every update is dropped.
        let sink = SurfaceUpdates::default();
        let channel_side = sink.clone();
        channel_side.push(SurfaceUpdate { x: 0, y: 0, width: 1, height: 1, rgba: vec![1, 2, 3, 4] });

        assert_eq!(sink.drain().len(), 1);
    }
}
