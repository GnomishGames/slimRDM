import { describe, expect, test } from "vitest";
import { cursorCss, cursorPlan, RdpCursorEvent } from "./rdpCursor";

const bitmap = (over: Partial<RdpCursorEvent> = {}): RdpCursorEvent => ({
  kind: "bitmap",
  width: 32,
  height: 32,
  hotspotX: 5,
  hotspotY: 6,
  data: "AAAA",
  ...over,
});

describe("cursorPlan", () => {
  // The bug: Windows ships the double-headed resize arrow as a pointer bitmap
  // and never paints it into the framebuffer, so the canvas keeps the local
  // arrow unless the bitmap becomes a real CSS cursor.
  test("renders a bitmap at its native size on a 1x display", () => {
    expect(cursorPlan(bitmap(), 1)).toEqual({
      type: "bitmap",
      sourceWidth: 32,
      sourceHeight: 32,
      cssWidth: 32,
      cssHeight: 32,
      hotspotX: 5,
      hotspotY: 6,
    });
  });

  test("halves size and hotspot on a 2x display", () => {
    // Remote pixels map 1:1 to device pixels, so a 32px cursor is 16 CSS px.
    expect(cursorPlan(bitmap({ hotspotX: 10, hotspotY: 8 }), 2)).toEqual({
      type: "bitmap",
      sourceWidth: 32,
      sourceHeight: 32,
      cssWidth: 16,
      cssHeight: 16,
      hotspotX: 5,
      hotspotY: 4,
    });
  });

  test("hides the cursor", () => {
    expect(cursorPlan({ ...bitmap(), kind: "hidden" }, 1)).toEqual({ type: "none" });
  });

  test("falls back to the local arrow for the default pointer", () => {
    expect(cursorPlan({ ...bitmap(), kind: "default" }, 1)).toEqual({ type: "default" });
  });

  test("falls back when a sized bitmap carries no pixels", () => {
    expect(cursorPlan(bitmap({ data: "" }), 1)).toEqual({ type: "default" });
  });

  // ironrdp decodes a 0x0 pointer attribute to `new_invisible()`, so this is
  // the server hiding the cursor — showing the local arrow instead would put a
  // pointer on screen that the remote does not have.
  test("hides the cursor for an invisible (0x0) bitmap", () => {
    expect(cursorPlan(bitmap({ width: 0, height: 0, data: "" }), 1)).toEqual({ type: "none" });
  });

  // WebKit ignores cursor images past 128 CSS px — and an ignored image drops
  // the whole declaration — but scaling one down keeps the shape cue that
  // large-cursor accessibility settings exist to give.
  test("scales an oversized bitmap down instead of dropping the shape", () => {
    expect(cursorPlan(bitmap({ width: 256, height: 256, hotspotX: 128, hotspotY: 0 }), 1))
      .toEqual({
        type: "bitmap",
        sourceWidth: 256,
        sourceHeight: 256,
        cssWidth: 128,
        cssHeight: 128,
        hotspotX: 64,
        hotspotY: 0,
      });
  });

  test("keeps the hotspot on the image at fractional display scales", () => {
    // GNOME/WebKitGTK produce 1.25 and 1.5. The hotspot has to follow the
    // ratio the image is drawn at, not 1/scale, or it drifts off the tip.
    const plan = cursorPlan(bitmap({ width: 32, height: 32, hotspotX: 31, hotspotY: 31 }), 1.5);
    expect(plan).toMatchObject({ type: "bitmap", cssWidth: 21, cssHeight: 21 });
    expect(plan).toMatchObject({ hotspotX: 20, hotspotY: 20 });
  });

  test("clamps a hotspot outside the image", () => {
    expect(cursorPlan(bitmap({ hotspotX: 99, hotspotY: 99 }), 1)).toMatchObject({
      hotspotX: 31,
      hotspotY: 31,
    });
  });
});

describe("cursorCss", () => {
  test("builds a url cursor with its hotspot and an arrow fallback", () => {
    const plan = cursorPlan(bitmap(), 1);
    expect(cursorCss(plan, "data:image/png;base64,AAA")).toBe(
      'url("data:image/png;base64,AAA") 5 6, default'
    );
  });

  test("maps the non-bitmap plans to CSS keywords", () => {
    expect(cursorCss({ type: "none" }, null)).toBe("none");
    expect(cursorCss({ type: "default" }, null)).toBe("default");
  });

  test("falls back to the arrow when the bitmap could not be encoded", () => {
    expect(cursorCss(cursorPlan(bitmap(), 1), null)).toBe("default");
  });
});
