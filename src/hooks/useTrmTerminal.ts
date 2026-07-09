import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { UnlistenFn, listen } from "@tauri-apps/api/event";
import { trm, clipboard } from "../utils/tauri";
import { getTheme } from "../utils/terminalThemes";
import { createLinkHandler } from "../utils/linkHandler";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import { Connection } from "../types";

interface UseTrmTerminalOptions {
  sessionId: string;
  connection: Connection;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function useTrmTerminal({ sessionId, connection, containerRef }: UseTrmTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const listenersRef = useRef<Promise<UnlistenFn>[]>([]);
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);
  const closePane = useAppStore((s) => s.closePane);

  useEffect(() => {
    if (!containerRef.current) return;
    const { terminal: settings } = useSettingsStore.getState();

    containerRef.current.style.padding = "2px 6px";
    containerRef.current.style.boxSizing = "border-box";

    const term = new Terminal({
      cursorBlink: settings.cursorBlink,
      cursorStyle: settings.cursorStyle,
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      scrollback: settings.scrollback,
      lineHeight: 1.2,
      theme: getTheme(settings.theme),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon(createLinkHandler(term)));
    term.open(containerRef.current);

    // GPU renderer — the DOM renderer falls behind on full-screen TUI redraws
    // (e.g. Claude Code), leaving stale/misplaced cells. WebGL renders the whole
    // grid on one texture and keeps up. Fall back to DOM if the context is lost
    // or WebGL is unavailable.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL unavailable — xterm.js keeps the DOM renderer.
    }

    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => { trm.sendInput(sessionId, data); });
    term.onResize(({ cols, rows }) => { trm.resize(sessionId, cols, rows); });
    term.onSelectionChange(() => {
      if (!useSettingsStore.getState().behavior.copyOnSelect) return;
      const sel = term.getSelection();
      if (sel) {
        clipboard.setSystem(sel)
          .then(() => useToastStore.getState().show("Copied"))
          .catch(() => {});
      }
    });

    listenersRef.current = [
      listen<{ sessionId: string; data: string }>("trm-output", (event) => {
        if (event.payload.sessionId === sessionId) {
          term.write(event.payload.data);
        }
      }),
      listen<{ sessionId: string; status: string; message?: string }>("trm-status", (event) => {
        if (event.payload.sessionId === sessionId) {
          const { status, message } = event.payload;
          if (status === "connected") {
            setSessionStatus(sessionId, "connected");
            term.writeln("\r\n\x1b[32m● Connected\x1b[0m\r\n");
          } else if (status === "disconnected") {
            closePane(sessionId);
          } else if (status === "error") {
            setSessionStatus(sessionId, "error", message);
            term.writeln(`\r\n\x1b[31m● Error: ${message ?? "unknown"}\x1b[0m`);
          }
        }
      }),
    ];

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      term.refresh(0, term.rows - 1);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      listenersRef.current.forEach((p) => p.then((fn) => fn()));
      resizeObserver.disconnect();
      trm.disconnect(sessionId);
      term.dispose();
    };
  }, [sessionId]);

  useEffect(() => {
    return useSettingsStore.subscribe((state) => {
      const term = termRef.current;
      if (!term) return;
      const s = state.terminal;
      term.options.fontFamily = s.fontFamily;
      term.options.fontSize = s.fontSize;
      term.options.scrollback = s.scrollback;
      term.options.cursorStyle = s.cursorStyle;
      term.options.cursorBlink = s.cursorBlink;
      term.options.lineHeight = 1.2;
      term.options.theme = getTheme(s.theme);
      fitAddonRef.current?.fit();
      term.refresh(0, term.rows - 1);
    });
  }, []);

  const connect = useCallback(async () => {
    const term = termRef.current;
    try {
      await Promise.all(listenersRef.current);
    } catch (err) {
      term?.writeln(`\r\n\x1b[31m● Event listener setup failed: ${err}\x1b[0m`);
      return;
    }
    try {
      await trm.connect({
        sessionId,
        workingDirectory: connection.workingDirectory,
        shellPath: connection.shellPath,
        startupCommands: connection.startupCommands,
        initialCols: term?.cols,
        initialRows: term?.rows,
      });
    } catch (err) {
      const msg = String(err);
      term?.writeln(`\r\n\x1b[31m● Failed to launch: ${msg}\x1b[0m`);
      setSessionStatus(sessionId, "error", msg);
    }
  }, [sessionId, connection]);

  const fit = () => {
    fitAddonRef.current?.fit();
    if (termRef.current) termRef.current.refresh(0, termRef.current.rows - 1);
  };

  return { connect, term: termRef, fit };
}
