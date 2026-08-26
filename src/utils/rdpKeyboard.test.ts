import { describe, expect, test } from "vitest";
import {
  isModifierCode,
  KeyEventLike,
  reconcileModifiers,
  keyEventLike,
  releaseHeldKeys,
} from "./rdpKeyboard";

const ev = (code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("reconcileModifiers", () => {
  // The bug: WebKitGTK/ibus swallows the ControlLeft keydown, so the only
  // evidence Ctrl is down is `ctrlKey: true` on the "c" keydown.
  test("presses a modifier the remote never saw go down", () => {
    const held = new Set<string>();
    expect(reconcileModifiers(held, ev("KeyC", { ctrlKey: true }), true)).toEqual([
      { code: "ControlLeft", pressed: true },
    ]);
    expect(held.has("ControlLeft")).toBe(true);
  });

  test("does not re-press a modifier already held", () => {
    const held = new Set(["ControlLeft"]);
    expect(reconcileModifiers(held, ev("KeyC", { ctrlKey: true }), true)).toEqual([]);
  });

  test("releases a modifier once the flag clears", () => {
    const held = new Set(["ControlLeft"]);
    expect(reconcileModifiers(held, ev("KeyA"), true)).toEqual([
      { code: "ControlLeft", pressed: false },
    ]);
    expect(held.size).toBe(0);
  });

  // This platform reports ctrlKey: true on the Control keyup itself. Trusting
  // the flag there would re-press Ctrl on the remote and leave it stuck down.
  test("a modifier's own keyup releases it despite the flag still being set", () => {
    const held = new Set(["ControlLeft"]);
    expect(
      reconcileModifiers(held, ev("ControlLeft", { ctrlKey: true }), false),
    ).toEqual([{ code: "ControlLeft", pressed: false }]);
    expect(held.size).toBe(0);
  });

  test("a modifier's own keydown presses that exact side", () => {
    const held = new Set<string>();
    expect(
      reconcileModifiers(held, ev("ControlRight", { ctrlKey: true }), true),
    ).toEqual([{ code: "ControlRight", pressed: true }]);
  });

  test("a release for a modifier the remote never held is not emitted", () => {
    const held = new Set<string>();
    expect(
      reconcileModifiers(held, ev("ControlLeft", { ctrlKey: true }), false),
    ).toEqual([]);
  });

  test("handles several modifiers at once (Ctrl+Shift+Esc)", () => {
    const held = new Set<string>();
    const actions = reconcileModifiers(
      held,
      ev("Escape", { ctrlKey: true, shiftKey: true }),
      true,
    );
    expect(actions).toEqual([
      { code: "ControlLeft", pressed: true },
      { code: "ShiftLeft", pressed: true },
    ]);
  });

  test("releases the right-hand side when that is what is held", () => {
    const held = new Set(["ControlRight"]);
    expect(reconcileModifiers(held, ev("KeyA"), true)).toEqual([
      { code: "ControlRight", pressed: false },
    ]);
  });

  test("a keyup never synthesizes a modifier press", () => {
    // Ctrl can go down while an unrelated key is being released; tapping Ctrl
    // on the remote there would be noise, so no press is emitted or recorded.
    const held = new Set<string>();
    expect(reconcileModifiers(held, ev("KeyA", { ctrlKey: true }), false)).toEqual([]);
    expect(held.size).toBe(0);
  });

  test("keeping Ctrl held across a keyup emits nothing", () => {
    const held = new Set(["ControlLeft"]);
    expect(reconcileModifiers(held, ev("KeyC", { ctrlKey: true }), false)).toEqual([]);
    expect(held.has("ControlLeft")).toBe(true);
  });
});

describe("releaseHeldKeys", () => {
  test("releases everything held and clears state", () => {
    const held = new Set(["ControlLeft", "ShiftLeft"]);
    expect(releaseHeldKeys(held)).toEqual([
      { code: "ControlLeft", pressed: false },
      { code: "ShiftLeft", pressed: false },
    ]);
    expect(held.size).toBe(0);
  });
});

describe("isModifierCode", () => {
  test("identifies both sides of every modifier", () => {
    for (const code of [
      "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
      "AltLeft", "AltRight", "MetaLeft", "MetaRight",
    ]) {
      expect(isModifierCode(code)).toBe(true);
    }
    expect(isModifierCode("KeyC")).toBe(false);
    expect(isModifierCode("CapsLock")).toBe(false);
  });
});

describe("AltGr", () => {
  // X11 + European layout: AltGr is code "AltRight" with altKey false and only
  // getModifierState("AltGraph") set.
  test("an AltGr chord is not broken up by a mid-chord release", () => {
    const held = new Set<string>();
    expect(
      reconcileModifiers(held, ev("AltRight", { altGraph: true }), true),
    ).toEqual([{ code: "AltRight", pressed: true }]);
    // The next key of the chord must NOT release AltRight.
    expect(reconcileModifiers(held, ev("KeyQ", { altGraph: true }), true)).toEqual([]);
    expect(held.has("AltRight")).toBe(true);
  });

  test("releasing AltGr clears it", () => {
    const held = new Set(["AltRight"]);
    expect(
      reconcileModifiers(held, ev("AltRight", { altGraph: true }), false),
    ).toEqual([{ code: "AltRight", pressed: false }]);
  });
});

describe("mouse events", () => {
  // Mouse events carry modifier flags but no code — Ctrl+click must arrive at
  // the server with Ctrl actually down.
  test("a click with Ctrl held presses Ctrl first", () => {
    const held = new Set<string>();
    expect(reconcileModifiers(held, ev("", { ctrlKey: true }), true)).toEqual([
      { code: "ControlLeft", pressed: true },
    ]);
  });

  test("a plain click releases a stale modifier", () => {
    const held = new Set(["ControlLeft"]);
    expect(reconcileModifiers(held, ev(""), true)).toEqual([
      { code: "ControlLeft", pressed: false },
    ]);
  });
});

describe("keyEventLike", () => {
  test("reads AltGraph via getModifierState", () => {
    const adapted = keyEventLike({
      code: "AltRight",
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
      getModifierState: (k) => k === "AltGraph",
    });
    expect(adapted).toEqual({
      code: "AltRight",
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
      altGraph: true,
    });
  });

  test("a mouse event with no code adapts to an empty code", () => {
    const adapted = keyEventLike({
      ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
    });
    expect(adapted.code).toBe("");
    expect(adapted.altGraph).toBe(false);
  });
});
