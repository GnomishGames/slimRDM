// Remote cursor shape rendering.
//
// The session is configured with `pointer_software_rendering: false`, so the
// server never paints the cursor into the framebuffer — it ships the pointer
// bitmap out of band and expects the client to draw it. Every shape Windows
// uses to tell you what a click will do (the double-headed resize arrows on a
// window border, the I-beam, the hand, the busy ring) lives only in those
// pointer updates. Drop them and the canvas keeps showing the local arrow no
// matter what the remote cursor is.

export type RdpCursorKind = "bitmap" | "default" | "hidden";

export type RdpCursorEvent = {
  kind: RdpCursorKind;
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  /** base64 RGBA, non-premultiplied; empty unless kind is "bitmap". */
  data: string;
};

export type CursorPlan =
  | { type: "none" }
  | { type: "default" }
  | {
      type: "bitmap";
      /** Size of the incoming bitmap, in remote-desktop pixels. */
      sourceWidth: number;
      sourceHeight: number;
      /** Size to render at, in CSS pixels. */
      cssWidth: number;
      cssHeight: number;
      /** Hotspot, in CSS pixels. */
      hotspotX: number;
      hotspotY: number;
    };

// WebKit refuses a cursor image larger than this, and a refused image
// invalidates the whole `cursor` declaration — which would leave the canvas
// with no cursor at all rather than falling back to the arrow. Oversized
// pointers (large-cursor accessibility settings ship 96px and 256px shapes)
// are scaled down to fit rather than dropped: a shrunken resize arrow still
// tells the user what a drag will do, the local arrow doesn't.
const MAX_CURSOR_CSS_SIZE = 128;

/**
 * Work out how to draw a pointer update, in CSS pixels.
 *
 * `scale` is remote pixels per CSS pixel. The canvas backing store holds one
 * remote pixel per device pixel, so this is the canvas's measured
 * `width / rect.width` — not `devicePixelRatio`, which only matches while the
 * layout that was computed from it is still current. A CSS cursor is sized in
 * CSS pixels, so the bitmap has to shrink by `scale` to sit at the right size
 * against the content it points at.
 */
export function cursorPlan(evt: RdpCursorEvent, scale: number): CursorPlan {
  if (evt.kind === "hidden") return { type: "none" };
  if (evt.kind !== "bitmap") return { type: "default" };
  // ironrdp decodes a 0x0 pointer attribute to its `new_invisible()` pointer,
  // which is the server saying "no cursor" through the bitmap path.
  if (evt.width <= 0 || evt.height <= 0) return { type: "none" };
  if (!evt.data) return { type: "default" };

  const ratio = scale > 0 ? scale : 1;
  let cssWidth = Math.max(1, Math.round(evt.width / ratio));
  let cssHeight = Math.max(1, Math.round(evt.height / ratio));
  if (cssWidth > MAX_CURSOR_CSS_SIZE || cssHeight > MAX_CURSOR_CSS_SIZE) {
    const shrink = MAX_CURSOR_CSS_SIZE / Math.max(cssWidth, cssHeight);
    cssWidth = Math.max(1, Math.round(cssWidth * shrink));
    cssHeight = Math.max(1, Math.round(cssHeight * shrink));
  }

  // The hotspot has to follow the ratio the image is actually drawn at, which
  // rounding and the size clamp make different from `1 / ratio`. A hotspot
  // outside the image invalidates the declaration, hence the clamp.
  const hotspotX = clamp(Math.round((evt.hotspotX * cssWidth) / evt.width), cssWidth - 1);
  const hotspotY = clamp(Math.round((evt.hotspotY * cssHeight) / evt.height), cssHeight - 1);

  return {
    type: "bitmap",
    sourceWidth: evt.width,
    sourceHeight: evt.height,
    cssWidth,
    cssHeight,
    hotspotX,
    hotspotY,
  };
}

/** The `cursor` value for a plan, given the encoded bitmap (null if encoding failed). */
export function cursorCss(plan: CursorPlan, dataUrl: string | null): string {
  if (plan.type === "none") return "none";
  if (plan.type === "default" || !dataUrl) return "default";
  return `url("${dataUrl}") ${plan.hotspotX} ${plan.hotspotY}, default`;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max, 0));
}
