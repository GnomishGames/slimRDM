import { useEffect, useRef, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { rdp, clipboard } from "../utils/tauri";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";
import { Connection, SessionStatus } from "../types";
import {
  ModifierAction,
  isModifierCode,
  keyEventLike,
  reconcileModifiers,
  releaseHeldKeys,
} from "../utils/rdpKeyboard";
import { CursorPlan, RdpCursorEvent, cursorCss, cursorPlan } from "../utils/rdpCursor";
import { base64ToRgba } from "../utils/rgba";

// RDP PointerFlags (from MS-RDPBCGR §2.2.8.1.2.2)
const PTR_MOVE        = 0x0800;
const PTR_LEFT_DOWN   = 0x9000; // LEFT_BUTTON | DOWN
const PTR_LEFT_UP     = 0x1000; // LEFT_BUTTON only
const PTR_RIGHT_DOWN  = 0xa000; // RIGHT_BUTTON | DOWN
const PTR_RIGHT_UP    = 0x2000; // RIGHT_BUTTON only
const PTR_MID_DOWN    = 0xc000; // MIDDLE | DOWN
const PTR_MID_UP      = 0x4000; // MIDDLE only
const PTR_WHEEL       = 0x0200; // VERTICAL_WHEEL
const PTR_WHEEL_NEG   = 0x0100; // WHEEL_NEGATIVE

// RDP KeyboardFlags
const KEY_DOWN    = 0x00;
const KEY_RELEASE = 0x01;
const KEY_EXTENDED = 0x02;

// KeyboardEvent.code → PS/2 scancode mapping
const SCANCODE: Record<string, { code: number; extended?: boolean }> = {
  Escape: { code: 0x01 }, F1: { code: 0x3b }, F2: { code: 0x3c },
  F3: { code: 0x3d }, F4: { code: 0x3e }, F5: { code: 0x3f },
  F6: { code: 0x40 }, F7: { code: 0x41 }, F8: { code: 0x42 },
  F9: { code: 0x43 }, F10: { code: 0x44 }, F11: { code: 0x57 },
  F12: { code: 0x58 },
  Backquote: { code: 0x29 }, Digit1: { code: 0x02 }, Digit2: { code: 0x03 },
  Digit3: { code: 0x04 }, Digit4: { code: 0x05 }, Digit5: { code: 0x06 },
  Digit6: { code: 0x07 }, Digit7: { code: 0x08 }, Digit8: { code: 0x09 },
  Digit9: { code: 0x0a }, Digit0: { code: 0x0b }, Minus: { code: 0x0c },
  Equal: { code: 0x0d }, Backspace: { code: 0x0e },
  Tab: { code: 0x0f }, KeyQ: { code: 0x10 }, KeyW: { code: 0x11 },
  KeyE: { code: 0x12 }, KeyR: { code: 0x13 }, KeyT: { code: 0x14 },
  KeyY: { code: 0x15 }, KeyU: { code: 0x16 }, KeyI: { code: 0x17 },
  KeyO: { code: 0x18 }, KeyP: { code: 0x19 }, BracketLeft: { code: 0x1a },
  BracketRight: { code: 0x1b }, Enter: { code: 0x1c },
  CapsLock: { code: 0x3a }, KeyA: { code: 0x1e }, KeyS: { code: 0x1f },
  KeyD: { code: 0x20 }, KeyF: { code: 0x21 }, KeyG: { code: 0x22 },
  KeyH: { code: 0x23 }, KeyJ: { code: 0x24 }, KeyK: { code: 0x25 },
  KeyL: { code: 0x26 }, Semicolon: { code: 0x27 }, Quote: { code: 0x28 },
  Backslash: { code: 0x2b },
  ShiftLeft: { code: 0x2a }, KeyZ: { code: 0x2c }, KeyX: { code: 0x2d },
  KeyC: { code: 0x2e }, KeyV: { code: 0x2f }, KeyB: { code: 0x30 },
  KeyN: { code: 0x31 }, KeyM: { code: 0x32 }, Comma: { code: 0x33 },
  Period: { code: 0x34 }, Slash: { code: 0x35 }, ShiftRight: { code: 0x36 },
  ControlLeft: { code: 0x1d }, AltLeft: { code: 0x38 },
  Space: { code: 0x39 },
  AltRight: { code: 0x38, extended: true },
  ControlRight: { code: 0x1d, extended: true },
  Insert: { code: 0x52, extended: true }, Delete: { code: 0x53, extended: true },
  Home: { code: 0x47, extended: true }, End: { code: 0x4f, extended: true },
  PageUp: { code: 0x49, extended: true }, PageDown: { code: 0x51, extended: true },
  ArrowUp: { code: 0x48, extended: true }, ArrowDown: { code: 0x50, extended: true },
  ArrowLeft: { code: 0x4b, extended: true }, ArrowRight: { code: 0x4d, extended: true },
  PrintScreen: { code: 0x37, extended: true },
  ScrollLock: { code: 0x46 }, Pause: { code: 0x45 },
  NumLock: { code: 0x45 }, Numpad0: { code: 0x52 }, Numpad1: { code: 0x4f },
  Numpad2: { code: 0x50 }, Numpad3: { code: 0x51 }, Numpad4: { code: 0x4b },
  Numpad5: { code: 0x4c }, Numpad6: { code: 0x4d }, Numpad7: { code: 0x47 },
  Numpad8: { code: 0x48 }, Numpad9: { code: 0x49 }, NumpadDecimal: { code: 0x53 },
  NumpadEnter: { code: 0x1c, extended: true }, NumpadAdd: { code: 0x4e },
  NumpadSubtract: { code: 0x4a }, NumpadMultiply: { code: 0x37 },
  NumpadDivide: { code: 0x35, extended: true },
  MetaLeft: { code: 0x5b, extended: true }, MetaRight: { code: 0x5c, extended: true },
  ContextMenu: { code: 0x5d, extended: true },
};

type JumpHostParams = {
  host: string;
  port: number;
  username: string;
  authType: string;
  credentialRef?: string;
  privateKeyPath?: string;
};

function resolveCredentials(conn: Connection): { username: string; credentialRef?: string } {
  if (conn.useGroupCredentials && conn.groupId) {
    const group = useAppStore.getState().groups.find((g) => g.id === conn.groupId);
    if (group?.username) {
      return { username: group.username, credentialRef: group.credentialRef };
    }
  }
  return { username: conn.username, credentialRef: conn.credentialRef };
}

function resolveJumpHostParams(conn: Connection): JumpHostParams | undefined {
  if (!conn.jumpHostId) return undefined;
  const jumpConn = useAppStore.getState().connections.find((c) => c.id === conn.jumpHostId);
  if (!jumpConn || jumpConn.connectionType !== "ssh") return undefined;
  const creds = resolveCredentials(jumpConn);
  return {
    host: jumpConn.host,
    port: jumpConn.port,
    username: creds.username,
    authType: jumpConn.authType,
    credentialRef: creds.credentialRef,
  };
}

interface UseRdpCanvasOptions {
  sessionId: string;
  connection: Connection;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

/**
 * Remote pixels per CSS pixel, measured from the live layout the way
 * `canvasCoords` does — `devicePixelRatio` only matches while the CSS size
 * computed from it is still current, and `flushFrames` pins that size once.
 */
function canvasScale(canvas: HTMLCanvasElement): number {
  const rect = canvas.getBoundingClientRect();
  if (canvas.width <= 0 || rect.width <= 0) return window.devicePixelRatio || 1;
  return canvas.width / rect.width;
}

/**
 * Turn a remote pointer bitmap into a PNG data URL at the size the plan asks
 * for. The bitmap arrives as non-premultiplied RGBA, which is exactly what
 * `putImageData` expects.
 */
function encodeCursor(evt: RdpCursorEvent, plan: CursorPlan): string | null {
  if (plan.type !== "bitmap") return null;
  try {
    const decoded = base64ToRgba(evt.data);
    // `ImageData` demands exactly 4 bytes per pixel and throws otherwise, so a
    // longer buffer has to be trimmed rather than passed through.
    const expected = plan.sourceWidth * plan.sourceHeight * 4;
    if (decoded.length < expected) return null;
    const bytes = decoded.length === expected ? decoded : decoded.subarray(0, expected);

    const source = document.createElement("canvas");
    source.width = plan.sourceWidth;
    source.height = plan.sourceHeight;
    const sourceCtx = source.getContext("2d");
    if (!sourceCtx) return null;
    sourceCtx.putImageData(new ImageData(bytes, plan.sourceWidth, plan.sourceHeight), 0, 0);

    if (plan.cssWidth === plan.sourceWidth && plan.cssHeight === plan.sourceHeight) {
      return source.toDataURL("image/png");
    }
    // On a HiDPI display the bitmap is in device pixels and a CSS cursor is
    // sized in CSS pixels, so it has to be scaled down to match the content.
    const scaled = document.createElement("canvas");
    scaled.width = plan.cssWidth;
    scaled.height = plan.cssHeight;
    const scaledCtx = scaled.getContext("2d");
    if (!scaledCtx) return null;
    scaledCtx.drawImage(source, 0, 0, plan.cssWidth, plan.cssHeight);
    return scaled.toDataURL("image/png");
  } catch {
    return null;
  }
}

type PendingFrame = {
  x: number; y: number;
  width: number; height: number;
  fullWidth: number; fullHeight: number;
  data: string;
};

export function useRdpCanvas({ sessionId, connection, canvasRef }: UseRdpCanvasOptions) {
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);
  const setSessionNote = useAppStore((s) => s.setSessionNote);
  const closePane = useAppStore((s) => s.closePane);
  const rdpDefaults = useSettingsStore((s) => s.rdpDefaults);
  const connectedRef = useRef(false);
  // Scancodes of the modifiers the remote currently believes are down. The
  // webview does not deliver a keydown for bare modifier keys on every
  // platform, so this is reconciled from each event's modifier flags rather
  // than driven by modifier key events. See utils/rdpKeyboard.ts.
  const heldModifiersRef = useRef<Set<string>>(new Set());
  // Ordinary (non-modifier) keys the remote believes are down, so a key held
  // when focus leaves doesn't auto-repeat on the remote forever.
  const heldKeysRef = useRef<Set<string>>(new Set());
  const pendingFramesRef = useRef<PendingFrame[]>([]);
  const rafIdRef = useRef<number | null>(null);

  // Connect and listen for frames
  useEffect(() => {
    let unlistenStatus: UnlistenFn | null = null;
    let unlistenFrame: UnlistenFn | null = null;
    let unlistenCursor: UnlistenFn | null = null;
    let unlistenClipboardText: UnlistenFn | null = null;

    const init = async () => {
      unlistenStatus = await listen<{ sessionId: string; status: string; message?: string }>(
        "rdp-status",
        (event) => {
          if (event.payload.sessionId !== sessionId) return;
          const { status, message } = event.payload;
          if (status === "disconnected") {
            closePane(sessionId);
          } else if (status === "error") {
            setSessionStatus(sessionId, status as SessionStatus, message);
          } else {
            // A message on a non-error status is progress, not a failure —
            // keeping it out of `error` so nothing reads a live session as one.
            setSessionStatus(sessionId, status as SessionStatus);
            setSessionNote(sessionId, message);
            if (status === "connected") connectedRef.current = true;
          }
        }
      );

      const flushFrames = () => {
        rafIdRef.current = null;
        const frames = pendingFramesRef.current;
        if (frames.length === 0) return;
        pendingFramesRef.current = [];

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        for (const { x, y, width, height, fullWidth, fullHeight, data } of frames) {
          if (canvas.width !== fullWidth) canvas.width = fullWidth;
          if (canvas.height !== fullHeight) canvas.height = fullHeight;
          // Pin the CSS display size to CSS pixels so the browser doesn't
          // stretch the higher-resolution canvas back up on HiDPI displays.
          if (!canvas.style.width) {
            const dpr = window.devicePixelRatio || 1;
            canvas.style.width  = Math.round(fullWidth  / dpr) + "px";
            canvas.style.height = Math.round(fullHeight / dpr) + "px";
          }

          ctx.putImageData(new ImageData(base64ToRgba(data), width, height), x, y);
        }
        // One flush per batch — keeps WebKitGTK compositing the full canvas correctly
        ctx.getImageData(0, 0, 1, 1);
      };

      unlistenFrame = await listen<{ sessionId: string } & PendingFrame>(
        "rdp-frame",
        (event) => {
          if (event.payload.sessionId !== sessionId) return;
          const { sessionId: _sid, ...frame } = event.payload;
          pendingFramesRef.current.push(frame);
          if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(flushFrames);
          }
        }
      );

      unlistenCursor = await listen<{ sessionId: string } & RdpCursorEvent>(
        "rdp-cursor",
        (event) => {
          if (event.payload.sessionId !== sessionId) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const plan = cursorPlan(event.payload, canvasScale(canvas));
          canvas.style.cursor = cursorCss(plan, encodeCursor(event.payload, plan));
        }
      );

      unlistenClipboardText = await listen<string>(
        "clipboard-remote-text",
        async (event) => {
          await clipboard.setSystem(event.payload).catch(() => {});
        }
      );

      const { username: resolvedUsername, credentialRef } = resolveCredentials(connection);
      const jumpHostParams = resolveJumpHostParams(connection);

      const wrapper = canvasRef.current?.parentElement;
      const dpr = window.devicePixelRatio || 1;
      await rdp.connect({
        sessionId,
        host: connection.host,
        port: connection.port,
        username: resolvedUsername,
        credentialRef,
        width:  Math.round((wrapper?.clientWidth  ?? rdpDefaults.width)  * dpr),
        height: Math.round((wrapper?.clientHeight ?? rdpDefaults.height) * dpr),
        performanceFlags: rdpDefaults.performanceFlags,
        connectionQuality: rdpDefaults.connectionQuality,
        jumpHostParams,
      }).catch((err: unknown) => {
        setSessionStatus(sessionId, "error", String(err));
      });
    };

    init().catch(console.error);

    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      pendingFramesRef.current = [];
      // Inline styles beat the stylesheet, so a `PointerHidden` left behind
      // would keep the canvas cursorless across a reconnect.
      canvasRef.current?.style.removeProperty("cursor");
      unlistenStatus?.();
      unlistenFrame?.();
      unlistenCursor?.();
      unlistenClipboardText?.();
      rdp.disconnect(sessionId).catch(() => {});
    };
  }, [sessionId]);

  // Map a CSS-space mouse event to canvas (RDP desktop) coordinates.
  // The canvas element is CSS-scaled to fill the panel, but its internal
  // resolution matches the remote desktop size — these can differ.
  function canvasCoords(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = e.target as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  // Forward mouse events
  const sendKey = useCallback((code: string, pressed: boolean) => {
    const entry = SCANCODE[code];
    if (!entry) return;
    const flags = (pressed ? KEY_DOWN : KEY_RELEASE) | (entry.extended ? KEY_EXTENDED : 0);
    rdp.keyEvent(sessionId, flags, entry.code).catch(() => {});
  }, [sessionId]);

  const applyModifiers = useCallback((actions: ModifierAction[]) => {
    for (const { code, pressed } of actions) sendKey(code, pressed);
  }, [sendKey]);

  // Bring the remote's modifier state in line with this event before sending the
  // keystroke or click it modifies. Every key and mouse event carries the
  // modifier flags, which is the only reliable source — see utils/rdpKeyboard.ts.
  const syncModifiers = useCallback((
    e: React.KeyboardEvent | React.MouseEvent | React.WheelEvent,
    isPress: boolean,
  ) => {
    applyModifiers(reconcileModifiers(heldModifiersRef.current, keyEventLike(e), isPress));
  }, [applyModifiers]);

  const releaseModifiers = useCallback(() => {
    applyModifiers(releaseHeldKeys(heldModifiersRef.current));
  }, [applyModifiers]);

  // Release everything the remote thinks is held when we lose focus. The matching
  // keyups go to whoever took focus, not to us, so without this an Alt-Tab while
  // holding Ctrl leaves Ctrl down, and one while holding ArrowDown leaves the
  // remote auto-repeating it.
  const releaseHeldInput = useCallback(() => {
    applyModifiers(releaseHeldKeys(heldKeysRef.current));
    releaseModifiers();
  }, [applyModifiers, releaseModifiers]);

  // Window blur covers Alt-Tab (the canvas keeps DOM focus); the canvas's own
  // onBlur covers focus moving elsewhere inside the app.
  useEffect(() => {
    window.addEventListener("blur", releaseHeldInput);
    return () => window.removeEventListener("blur", releaseHeldInput);
  }, [releaseHeldInput]);


  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    const { x, y } = canvasCoords(e);
    rdp.mouseEvent(sessionId, PTR_MOVE, x, y, 0).catch(() => {});
  }, [sessionId]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    // Ctrl+click / Shift+click need the modifier actually down on the remote,
    // and a click may be the first event to reveal that it is held.
    syncModifiers(e, true);
    const { x, y } = canvasCoords(e);
    const flags = e.button === 0 ? PTR_LEFT_DOWN : e.button === 2 ? PTR_RIGHT_DOWN : PTR_MID_DOWN;
    rdp.mouseEvent(sessionId, flags, x, y, 0).catch(() => {});
  }, [sessionId, syncModifiers]);

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    syncModifiers(e, false);
    const { x, y } = canvasCoords(e);
    const flags = e.button === 0 ? PTR_LEFT_UP : e.button === 2 ? PTR_RIGHT_UP : PTR_MID_UP;
    rdp.mouseEvent(sessionId, flags, x, y, 0).catch(() => {});
  }, [sessionId, syncModifiers]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    syncModifiers(e, true); // Ctrl+wheel zoom
    const { x, y } = canvasCoords(e);
    const rawDelta = e.deltaMode === 1
      ? Math.abs(e.deltaY) * 40   // line mode: scale up to pixel-equivalent
      : Math.abs(e.deltaY);        // pixel mode: use directly
    const units = Math.max(1, Math.min(255, Math.round(rawDelta)));
    const flags = PTR_WHEEL | (e.deltaY > 0 ? PTR_WHEEL_NEG : 0);
    rdp.mouseEvent(sessionId, flags, x, y, units).catch(() => {});
  }, [sessionId, syncModifiers]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;

    if (e.ctrlKey && e.code === "KeyV") {
      e.preventDefault();
      // Release held modifiers on the remote before typing so modifier state
      // doesn't interfere with the pasted text.
      releaseModifiers();
      clipboard.getSystem()
        .then((text) => { if (text) rdp.typeText(sessionId, text).catch(() => {}); })
        .catch(() => {});
      return;
    }

    e.preventDefault();
    // This is what makes Ctrl+C a break rather than a literal "c".
    syncModifiers(e, true);
    if (isModifierCode(e.code)) return; // already sent by the sync above
    if (SCANCODE[e.code]) heldKeysRef.current.add(e.code);
    sendKey(e.code, true);
  }, [sessionId, sendKey, syncModifiers, releaseModifiers]);

  const onKeyUp = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    e.preventDefault();
    syncModifiers(e, false);
    if (isModifierCode(e.code)) return; // already sent by the sync above
    heldKeysRef.current.delete(e.code);
    sendKey(e.code, false);
  }, [sendKey, syncModifiers]);

  return {
    onMouseMove, onMouseDown, onMouseUp, onWheel,
    onKeyDown, onKeyUp, onBlur: releaseHeldInput,
  };
}
