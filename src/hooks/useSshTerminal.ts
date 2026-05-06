import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { UnlistenFn, listen } from "@tauri-apps/api/event";
import { ssh, credentials } from "../utils/tauri";
import { getTheme } from "../utils/terminalThemes";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";
import { Connection } from "../types";

async function resolveCredentials(conn: Connection): Promise<{
  username: string;
  authType: string;
  password?: string;
  privateKeyPath?: string;
}> {
  if (conn.useGroupCredentials && conn.groupId) {
    const group = useAppStore.getState().groups.find((g) => g.id === conn.groupId);
    if (group?.username) {
      const groupAuthType = group.authType ?? "password";
      if (groupAuthType === "public_key") {
        return { username: group.username, authType: "public_key", privateKeyPath: group.privateKeyPath };
      }
      const password = group.credentialRef
        ? await credentials.get(group.credentialRef).catch(() => undefined)
        : undefined;
      return { username: group.username, authType: "password", password };
    }
  }
  let password: string | undefined;
  if (conn.authType === "password" && conn.credentialRef) {
    password = await credentials.get(conn.credentialRef).catch(() => undefined);
  }
  return { username: conn.username, authType: conn.authType, password, privateKeyPath: conn.privateKeyPath };
}

interface UseSshTerminalOptions {
  sessionId: string;
  connection: Connection;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function useSshTerminal({ sessionId, connection, containerRef }: UseSshTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const listenersRef = useRef<Promise<UnlistenFn>[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);
  const closeSession = useAppStore((s) => s.closeSession);

  // Create terminal on mount; use a snapshot of settings at that moment
  useEffect(() => {
    if (!containerRef.current) return;
    const { terminal: settings } = useSettingsStore.getState();

    // Add padding to the container to ensure the cursor and last line of text
    // are never clipped by the bottom edge of the window. This provides the
    // "controlled height" requested for better visibility.
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
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => { ssh.sendInput(sessionId, data); });
    term.onResize(({ cols, rows }) => { ssh.resize(sessionId, cols, rows); });
    term.onSelectionChange(() => {
      if (!useSettingsStore.getState().behavior.copyOnSelect) return;
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    });

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
            const { behavior, sshDefaults } = useSettingsStore.getState();
            if (behavior.autoReconnect) {
              setSessionStatus(sessionId, "connecting");
              term.writeln("\r\n\x1b[33m● Disconnected. Reconnecting in 3s…\x1b[0m");
              reconnectTimerRef.current = setTimeout(async () => {
                const conn = connectionRef.current;
                const resolved = await resolveCredentials(conn);
                try {
                  await ssh.connect({
                    sessionId,
                    host: conn.host,
                    port: conn.port,
                    username: resolved.username,
                    authType: resolved.authType,
                    password: resolved.password,
                    privateKeyPath: resolved.privateKeyPath ?? conn.privateKeyPath,
                    keepaliveInterval: sshDefaults.keepaliveInterval,
                    connectTimeout: sshDefaults.connectTimeout,
                    initialCols: termRef.current?.cols,
                    initialRows: termRef.current?.rows,
                  });
                } catch (err) {
                  const msg = String(err);
                  term.writeln(`\r\n\x1b[31m● Reconnect failed: ${msg}\x1b[0m`);
                  setSessionStatus(sessionId, "error", msg);
                }
              }, 3000);
            } else {
              closeSession(sessionId);
            }
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
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      listenersRef.current.forEach((p) => p.then((fn) => fn()));
      resizeObserver.disconnect();
      ssh.disconnect(sessionId);
      term.dispose();
    };
  }, [sessionId]);

  // Subscribe directly to the settings store — bypasses React's render/effect
  // cycle so xterm.js gets updated imperatively as soon as settings change.
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

  const connect = useCallback(async (password?: string) => {
    const term = termRef.current;
    try {
      await Promise.all(listenersRef.current);
    } catch (err) {
      term?.writeln(`\r\n\x1b[31m● Event listener setup failed: ${err}\x1b[0m`);
      return;
    }
    try {
      const { sshDefaults } = useSettingsStore.getState();
      const resolved = await resolveCredentials(connection);
      await ssh.connect({
        sessionId,
        host: connection.host,
        port: connection.port,
        username: resolved.username,
        authType: resolved.authType,
        password: connection.useGroupCredentials ? resolved.password : password,
        privateKeyPath: resolved.privateKeyPath ?? connection.privateKeyPath,
        keepaliveInterval: sshDefaults.keepaliveInterval,
        connectTimeout: sshDefaults.connectTimeout,
        initialCols: term?.cols,
        initialRows: term?.rows,
      });
    } catch (err) {
      const msg = String(err);
      term?.writeln(`\r\n\x1b[31m● Failed to connect: ${msg}\x1b[0m`);
      setSessionStatus(sessionId, "error", msg);
    }
  }, [sessionId, connection]);

  const fit = () => fitAddonRef.current?.fit();

  return { connect, term: termRef, fit };
}
