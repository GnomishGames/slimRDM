// Remote modifier state reconciliation.
//
// WebKitGTK (with an ibus IM context) never delivers a `keydown` for a bare
// modifier key — only the `keyup`. So a client that presses a modifier on the
// remote when its keydown arrives never presses Ctrl/Alt/Shift at all, and
// Ctrl+C reaches the server as a plain "c".
//
// Fix: never trust modifier *key events* to carry modifier state. Derive the
// intended state from the `ctrlKey`/`altKey`/`shiftKey`/`metaKey` flags that
// every key event carries, and synthesize the down/up scancodes needed to make
// the remote match before the main key is sent.

export type ModifierFlag = "ctrlKey" | "shiftKey" | "altKey" | "metaKey";

type ModifierGroup = { flag: ModifierFlag; left: string; right: string };

const MODIFIER_GROUPS: ModifierGroup[] = [
  { flag: "ctrlKey",  left: "ControlLeft", right: "ControlRight" },
  { flag: "shiftKey", left: "ShiftLeft",   right: "ShiftRight" },
  { flag: "altKey",   left: "AltLeft",     right: "AltRight" },
  { flag: "metaKey",  left: "MetaLeft",    right: "MetaRight" },
];

const CODE_TO_GROUP = new Map<string, ModifierGroup>();
for (const g of MODIFIER_GROUPS) {
  CODE_TO_GROUP.set(g.left, g);
  CODE_TO_GROUP.set(g.right, g);
}

export function isModifierCode(code: string): boolean {
  return CODE_TO_GROUP.has(code);
}

/** The subset of a keyboard/mouse event this module needs — keeps it testable. */
export type KeyEventLike = {
  /** Empty for mouse events, which modify state without naming a key. */
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /**
   * AltGr. On X11 with a European layout AltGr arrives as `code: "AltRight"`
   * with `altKey: false` — only `getModifierState("AltGraph")` is set. Without
   * this, the alt group looks unwanted on the next keydown and AltRight gets
   * released mid-chord, so AltGr+Q taps Alt and types "q" instead of "@".
   */
  altGraph?: boolean;
};

type DomEventLike = {
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  // Narrowed to the one key this module asks for, so DOM/React event types
  // (whose parameter is a `ModifierKey` union) are assignable here.
  getModifierState?: (key: "AltGraph") => boolean;
};

/**
 * Adapt a DOM keyboard or mouse event. Mouse events carry modifier flags but no
 * `code`, which is exactly the shape `reconcileModifiers` wants for them.
 */
export function keyEventLike(e: DomEventLike): KeyEventLike {
  return {
    code: e.code ?? "",
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    altGraph: e.getModifierState?.("AltGraph") ?? false,
  };
}

export type ModifierAction = { code: string; pressed: boolean };

/**
 * Diff the remote's modifier state (`held`, mutated in place) against what
 * `event` implies, and return the press/release actions that close the gap.
 *
 * `isKeyDown` distinguishes press from release. For a modifier key's *own*
 * event the flag is unreliable — this platform reports `ctrlKey: true` on the
 * Control keyup — so the event type wins for that key's own group.
 */
export function reconcileModifiers(
  held: Set<string>,
  event: KeyEventLike,
  isKeyDown: boolean,
): ModifierAction[] {
  const ownGroup = CODE_TO_GROUP.get(event.code);
  const actions: ModifierAction[] = [];

  for (const group of MODIFIER_GROUPS) {
    // AltGr sets AltGraph rather than altKey on some platforms — treat either
    // as "alt is wanted" so an AltGr chord is not broken up.
    const flagSet = group.flag === "altKey"
      ? event.altKey || !!event.altGraph
      : event[group.flag];
    const desired = group === ownGroup ? isKeyDown : flagSet;
    const heldCodes = [group.left, group.right].filter((c) => held.has(c));

    // Only a key *press* can need a modifier pressed first — synthesizing one
    // on a release would tap Ctrl for no reason (a modifier can legitimately go
    // down while an unrelated key is being released).
    if (desired && isKeyDown && heldCodes.length === 0) {
      // Prefer the side the event names; fall back to left when synthesizing.
      const code = group === ownGroup ? event.code : group.left;
      held.add(code);
      actions.push({ code, pressed: true });
    } else if (!desired) {
      for (const code of heldCodes) {
        held.delete(code);
        actions.push({ code, pressed: false });
      }
    }
  }

  return actions;
}

/** Release every key in `held` (mutates it). Used for modifiers and plain keys. */
export function releaseHeldKeys(held: Set<string>): ModifierAction[] {
  const actions = [...held].map((code) => ({ code, pressed: false }));
  held.clear();
  return actions;
}
