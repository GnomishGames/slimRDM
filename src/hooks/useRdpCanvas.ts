import { useEffect, useRef, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { rdp, credentials } from "../utils/tauri";
import { useAppStore } from "../store/appStore";
import { Connection, SessionStatus } from "../types";

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

interface UseRdpCanvasOptions {
  sessionId: string;
  connection: Connection;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function useRdpCanvas({ sessionId, connection, canvasRef }: UseRdpCanvasOptions) {
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);
  const closeSession = useAppStore((s) => s.closeSession);
  const connectedRef = useRef(false);

  // Connect and listen for frames
  useEffect(() => {
    let unlistenStatus: UnlistenFn | null = null;
    let unlistenFrame: UnlistenFn | null = null;

    const init = async () => {
      unlistenStatus = await listen<{ sessionId: string; status: string; message?: string }>(
        "rdp-status",
        (event) => {
          if (event.payload.sessionId !== sessionId) return;
          const { status, message } = event.payload;
          if (status === "disconnected") {
            closeSession(sessionId);
          } else {
            setSessionStatus(sessionId, status as SessionStatus, message);
            if (status === "connected") connectedRef.current = true;
          }
        }
      );

      unlistenFrame = await listen<{
        sessionId: string;
        x: number; y: number;
        width: number; height: number;
        fullWidth: number; fullHeight: number;
        data: string;
      }>(
        "rdp-frame",
        (event) => {
          if (event.payload.sessionId !== sessionId) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          const { x, y, width, height, fullWidth, fullHeight, data } = event.payload;
          // Set canvas internal resolution to match RDP desktop size
          if (canvas.width !== fullWidth) canvas.width = fullWidth;
          if (canvas.height !== fullHeight) canvas.height = fullHeight;

          // Raw RGBA — decode base64 to Uint8ClampedArray
          const binary = atob(data);
          const bytes = new Uint8ClampedArray(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          // Create ImageData — RGBA is 4 bytes per pixel
          const imageData = new ImageData(bytes, width, height);
          ctx.putImageData(imageData, x, y);
          // Force browser repaint — putImageData() may not trigger compositing
          // Reading back data forces the browser to flush the canvas buffer
          ctx.getImageData(0, 0, 1, 1);
        }
      );

      let password: string | undefined;
      if (connection.credentialRef) {
        password = await credentials.get(connection.credentialRef).catch(() => undefined);
      }

      const canvas = canvasRef.current;
      await rdp.connect({
        sessionId,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password,
        width: canvas?.clientWidth ?? 1280,
        height: canvas?.clientHeight ?? 800,
      }).catch((err: unknown) => {
        setSessionStatus(sessionId, "error", String(err));
      });
    };

    init().catch(console.error);

    return () => {
      unlistenStatus?.();
      unlistenFrame?.();
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
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    const { x, y } = canvasCoords(e);
    rdp.mouseEvent(sessionId, PTR_MOVE, x, y).catch(() => {});
  }, [sessionId]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    const { x, y } = canvasCoords(e);
    const flags = e.button === 0 ? PTR_LEFT_DOWN : e.button === 2 ? PTR_RIGHT_DOWN : PTR_MID_DOWN;
    rdp.mouseEvent(sessionId, flags, x, y).catch(() => {});
  }, [sessionId]);

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    const { x, y } = canvasCoords(e);
    const flags = e.button === 0 ? PTR_LEFT_UP : e.button === 2 ? PTR_RIGHT_UP : PTR_MID_UP;
    rdp.mouseEvent(sessionId, flags, x, y).catch(() => {});
  }, [sessionId]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    const { x, y } = canvasCoords(e);
    const isNeg = e.deltaY > 0;
    const units = Math.min(Math.abs(Math.round(e.deltaY / 40)), 255);
    const flags = PTR_WHEEL | (isNeg ? PTR_WHEEL_NEG : 0) | units;
    rdp.mouseEvent(sessionId, flags, x, y).catch(() => {});
  }, [sessionId]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    e.preventDefault();
    const entry = SCANCODE[e.code];
    if (!entry) return;
    const flags = (KEY_DOWN) | (entry.extended ? KEY_EXTENDED : 0);
    rdp.keyEvent(sessionId, flags, entry.code).catch(() => {});
  }, [sessionId]);

  const onKeyUp = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!connectedRef.current) return;
    e.preventDefault();
    const entry = SCANCODE[e.code];
    if (!entry) return;
    const flags = KEY_RELEASE | (entry.extended ? KEY_EXTENDED : 0);
    rdp.keyEvent(sessionId, flags, entry.code).catch(() => {});
  }, [sessionId]);

  return { onMouseMove, onMouseDown, onMouseUp, onWheel, onKeyDown, onKeyUp };
}
