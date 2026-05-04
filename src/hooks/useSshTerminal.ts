import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { UnlistenFn, listen } from "@tauri-apps/api/event";
import { ssh } from "../utils/tauri";
import { useAppStore } from "../store/appStore";
import { Connection } from "../types";

interface UseSshTerminalOptions {
  sessionId: string;
  connection: Connection;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function useSshTerminal({ sessionId, connection, containerRef }: UseSshTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  // Store listener promises so connect() can await them before invoking SSH
  const listenersRef = useRef<Promise<UnlistenFn>[]>([]);
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => { ssh.sendInput(sessionId, data); });
    term.onResize(({ cols, rows }) => { ssh.resize(sessionId, cols, rows); });

    listenersRef.current = [
      listen<{ sessionId: string; data: string }>("ssh-output", (event) => {
        if (event.payload.sessionId === sessionId) {
          term.write(event.payload.data);
        }
      }),
      listen<{ sessionId: string; status: string; message?: string }>("ssh-status", (event) => {
        if (event.payload.sessionId === sessionId) {
          const { status, message } = event.payload;
          if (status === "connected") {
            setSessionStatus(sessionId, "connected");
            term.writeln("\r\n\x1b[32m● Connected\x1b[0m\r\n");
          } else if (status === "disconnected") {
            setSessionStatus(sessionId, "disconnected");
            term.writeln("\r\n\x1b[33m● Connection closed\x1b[0m");
          } else if (status === "error") {
            setSessionStatus(sessionId, "error", message);
            term.writeln(`\r\n\x1b[31m● Error: ${message ?? "unknown"}\x1b[0m`);
          }
        }
      }),
    ];

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      listenersRef.current.forEach((p) => p.then((fn) => fn()));
      resizeObserver.disconnect();
      ssh.disconnect(sessionId);
      term.dispose();
    };
  }, [sessionId]);

  const connect = useCallback(async (password?: string) => {
    const term = termRef.current;

    try {
      await Promise.all(listenersRef.current);
    } catch (err) {
      term?.writeln(`\r\n\x1b[31m● Event listener setup failed: ${err}\x1b[0m`);
      return;
    }

    try {
      await ssh.connect({
        sessionId,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        authType: connection.authType,
        password,
        privateKeyPath: connection.privateKeyPath,
      });
    } catch (err) {
      const msg = String(err);
      term?.writeln(`\r\n\x1b[31m● Failed to connect: ${msg}\x1b[0m`);
      setSessionStatus(sessionId, "error", msg);
    }
  }, [sessionId, connection]);

  return { connect, term: termRef };
}
