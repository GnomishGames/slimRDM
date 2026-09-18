//! NSCodec subcodec of ClearCodec ([MS-RDPNSC]).
//!
//! PATCH (slimRDM): upstream leaves `SubcodecId::NsCodec` as a silent no-op,
//! on the reasoning that its own encoder never emits one. Windows does — it
//! uses NSCodec for photographic and icon content — and because the branch
//! returns success while writing nothing, every such region was painted solid
//! black over whatever was already there, with no error to show for it.
//!
//! The bitmap is carried as three (optionally four) RLE-encoded planes in
//! YCoCg space. Chroma may be subsampled, and a colour-loss level records how
//! far the chroma values were shifted down by the encoder.

use ironrdp_core::{DecodeResult, ReadCursor, ensure_size, invalid_field_err};

/// Fixed part of `NSCODEC_BITMAP_STREAM`: four plane sizes, colour-loss level,
/// chroma subsampling level, and two reserved bytes.
const HEADER_SIZE: usize = 20;

/// Decode one NSCodec region into `output`, a BGRA buffer of `surface_width`
/// stride, writing at (`x_start`, `y_start`).
pub(crate) fn decode(
    data: &[u8],
    x_start: usize,
    y_start: usize,
    width: usize,
    height: usize,
    surface_width: usize,
    output: &mut [u8],
) -> DecodeResult<()> {
    let mut src = ReadCursor::new(data);
    ensure_size!(ctx: "NsCodecHeader", in: src, size: HEADER_SIZE);

    let luma_len = src.read_u32() as usize;
    let orange_len = src.read_u32() as usize;
    let green_len = src.read_u32() as usize;
    let alpha_len = src.read_u32() as usize;
    let color_loss_level = src.read_u8();
    let chroma_subsampling = src.read_u8();
    let _reserved = src.read_u16();

    // MS-RDPNSC constrains the colour-loss level to 1..7, and it is used below
    // as a shift amount: anything higher shifts a u8 by 8 or more, which panics
    // in a debug build and is silently masked in release.
    if !(1..=7).contains(&color_loss_level) {
        return Err(invalid_field_err!("colorLossLevel", "outside the permitted range 1..7"));
    }

    let planes = src.remaining();
    let total = luma_len
        .checked_add(orange_len)
        .and_then(|v| v.checked_add(green_len))
        .and_then(|v| v.checked_add(alpha_len))
        .ok_or_else(|| invalid_field_err!("planeByteCount", "plane sizes overflow"))?;
    if planes.len() < total {
        return Err(invalid_field_err!("planeByteCount", "plane data shorter than declared"));
    }

    // Plane strides are not the region's own dimensions when chroma is
    // subsampled: the luma plane is padded to a multiple of 8 and the chroma
    // planes are derived from that padded width, as FreeRDP's `nsc_decode`
    // does. Every payload captured from this host has subsampling off, so the
    // subsampled path is written to the specification rather than verified
    // against real data.
    let (luma_stride, chroma_width, chroma_height) = if chroma_subsampling == 0 {
        (width, width, height)
    } else {
        let padded = width.next_multiple_of(8);
        (padded, padded / 2, height.div_ceil(2))
    };

    let (luma_data, rest) = planes.split_at(luma_len);
    let (orange_data, rest) = rest.split_at(orange_len);
    let (green_data, rest) = rest.split_at(green_len);
    let alpha_data = &rest[..alpha_len];

    let luma = decode_plane(luma_data, luma_stride * height)?;
    let orange = decode_plane(orange_data, chroma_width * chroma_height)?;
    let green = decode_plane(green_data, chroma_width * chroma_height)?;
    let alpha = if alpha_len > 0 {
        Some(decode_plane(alpha_data, luma_stride * height)?)
    } else {
        None
    };

    // The encoder shifted chroma down by one less than the colour-loss level.
    let shift = color_loss_level.saturating_sub(1);

    for row in 0..height {
        let chroma_row = if chroma_subsampling == 0 { row } else { row / 2 };
        for col in 0..width {
            let chroma_col = if chroma_subsampling == 0 { col } else { col / 2 };

            let y = i32::from(luma[row * luma_stride + col]);
            // Chroma is signed and stored shifted; recover it in 8-bit space
            // before widening, so the sign is taken from the shifted value.
            let co = i32::from((orange[chroma_row * chroma_width + chroma_col] << shift) as i8);
            let cg = i32::from((green[chroma_row * chroma_width + chroma_col] << shift) as i8);

            let r = (y + co - cg).clamp(0, 255) as u8;
            let g = (y + cg).clamp(0, 255) as u8;
            let b = (y - co - cg).clamp(0, 255) as u8;

            let dst = ((y_start + row) * surface_width + x_start + col) * 4;
            if dst + 4 > output.len() {
                continue;
            }
            output[dst] = b;
            output[dst + 1] = g;
            output[dst + 2] = r;
            output[dst + 3] = alpha
                .as_ref()
                .and_then(|a| a.get(row * luma_stride + col).copied())
                .unwrap_or(0xFF);
        }
    }

    Ok(())
}

/// Expand one plane.
///
/// A plane is only RLE-encoded when the encoder managed to shrink it. An empty
/// plane means "every byte is 0xFF", and a plane at or above its original size
/// is stored literally — decoding either of those as RLE reads run lengths out
/// of pixel data.
fn decode_plane(data: &[u8], original_size: usize) -> DecodeResult<Vec<u8>> {
    if data.is_empty() {
        return Ok(vec![0xFF; original_size]);
    }

    // Only an exact match means the plane was stored literally. A longer
    // plane is malformed, and reinterpreting its run lengths as pixels would
    // paint garbage over good content without reporting anything.
    if data.len() == original_size {
        return Ok(data.to_vec());
    }

    rle_decode(data, original_size)
}

/// Expand one RLE-encoded plane ([MS-RDPNSC] 2.2.2.1).
///
/// A byte that repeats introduces a run whose length follows; the final four
/// bytes of every plane are stored literally.
fn rle_decode(data: &[u8], original_size: usize) -> DecodeResult<Vec<u8>> {
    let mut out = Vec::with_capacity(original_size);
    let mut i = 0usize;
    let mut left = original_size;

    while left > 4 {
        let value = *data
            .get(i)
            .ok_or_else(|| invalid_field_err!("planeData", "plane ended mid-run"))?;
        i += 1;

        if left == 5 {
            out.push(value);
            left -= 1;
        } else if data.get(i) == Some(&value) {
            i += 1;
            let marker = *data
                .get(i)
                .ok_or_else(|| invalid_field_err!("planeData", "run length missing"))?;

            let len = if marker < 0xFF {
                i += 1;
                usize::from(marker) + 2
            } else {
                i += 1;
                let bytes = data
                    .get(i..i + 4)
                    .ok_or_else(|| invalid_field_err!("planeData", "extended run length truncated"))?;
                i += 4;
                u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize
            };

            if len > left {
                return Err(invalid_field_err!("planeData", "run exceeds plane size"));
            }
            out.extend(core::iter::repeat_n(value, len));
            left -= len;
        } else {
            out.push(value);
            left -= 1;
        }
    }

    let tail = data
        .get(i..i + left)
        .ok_or_else(|| invalid_field_err!("planeData", "literal tail truncated"))?;
    out.extend_from_slice(tail);

    if out.len() != original_size {
        return Err(invalid_field_err!("planeData", "plane decoded to the wrong size"));
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::rle_decode;

    #[test]
    fn a_run_expands_and_the_tail_stays_literal() {
        // 0x07 repeated (marker 0x00 -> length 2), then four literal bytes.
        let data = [0x07, 0x07, 0x00, 0x01, 0x02, 0x03, 0x04];

        let out = rle_decode(&data, 6).unwrap();

        assert_eq!(out, vec![0x07, 0x07, 0x01, 0x02, 0x03, 0x04]);
    }

    #[test]
    fn literals_pass_through() {
        let data = [0x01, 0x02, 0x03, 0x04, 0x05];

        let out = rle_decode(&data, 5).unwrap();

        assert_eq!(out, vec![0x01, 0x02, 0x03, 0x04, 0x05]);
    }

    #[test]
    fn an_uncompressed_plane_is_copied_not_rle_decoded() {
        // The encoder stores a plane literally when RLE would not shrink it.
        // Reading it as RLE misinterprets pixel values as run lengths, which is
        // what rejected real regions with "run exceeds plane size".
        let data = [0x10, 0x10, 0x20, 0x30];

        let out = super::decode_plane(&data, 4).unwrap();

        assert_eq!(out, vec![0x10, 0x10, 0x20, 0x30]);
    }

    #[test]
    fn a_plane_longer_than_its_output_is_not_taken_literally() {
        // Longer than the decoded size is malformed, not "stored raw".
        assert!(super::decode_plane(&[0x10, 0x10, 0x20, 0x30, 0x40], 4).is_err());
    }

    #[test]
    fn an_absent_plane_is_all_ones() {
        assert_eq!(super::decode_plane(&[], 3).unwrap(), vec![0xFF, 0xFF, 0xFF]);
    }

    #[test]
    fn a_run_longer_than_the_plane_is_rejected() {
        let data = [0x07, 0x07, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00];

        assert!(rle_decode(&data, 10).is_err());
    }
}
