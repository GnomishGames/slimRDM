import { describe, expect, test } from "vitest";
import { base64ToRgba } from "./rgba";

describe("base64ToRgba", () => {
  test("decodes to raw bytes", () => {
    // One opaque red pixel: 0xff 0x00 0x00 0xff
    expect(Array.from(base64ToRgba("/wAA/w=="))).toEqual([255, 0, 0, 255]);
  });

  test("decodes an empty payload", () => {
    expect(base64ToRgba("").length).toBe(0);
  });

  test("keeps high bytes intact", () => {
    // Uint8ClampedArray must not clamp values already in range.
    expect(Array.from(base64ToRgba("AID/"))).toEqual([0, 128, 255]);
  });
});
