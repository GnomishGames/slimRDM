import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { UnlistenFn, listen } from "@tauri-apps/api/event";
import { ssh, clipboard } from "../utils/tauri";
import { getTheme } from "../utils/terminalThemes";
import { createLinkHandler } from "../utils/linkHandler";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import { Connection, SessionLogParams } from "../types";

type ResolvedCreds = {
  username: string;
  authType: string;
  credentialRef?: string;
  privateKeyPath?: string;
};

type JumpHostParams = {
  host: string;
  port: number;
  username: string;
  authType: string;
  credentialRef?: string;
  privateKeyPath?: string;
};

function resolveCredentials(conn: Connection): ResolvedCreds {
  if (conn.useGroupCredentials && conn.groupId) {
    const group = useAppStore.getState().groups.find((g) => g.id === conn.groupId);
    if (group?.username) {
      const groupAuthType = group.authType ?? "password";
      if (groupAuthType === "public_key") {
        return { username: group.username, authType: "public_key", privateKeyPath: group.privateKeyPath };
      }
      return { username: group.username, authType: "password", credentialRef: group.credentialRef };
    }
  }
  return { username: conn.username, authType: conn.authType, credentialRef: conn.credentialRef, privateKeyPath: conn.privateKeyPath };
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
    authType: creds.authType,
    credentialRef: creds.credentialRef,
    privateKeyPath: creds.privateKeyPath ?? jumpConn.privateKeyPath,
  };
}

// Resolve whether this SSH session should be logged, mirroring resolveCredentials:
// the connection's tri-state wins, then the group's, then the global default.
// Returns backend log params only when logging is on AND a vault path is configured.
function resolveLogging(conn: Connection): SessionLogParams | undefined {
  const { logging } = useSettingsStore.getState();
  if (!logging.vaultPath) return undefined;

  const group = conn.groupId
    ? useAppStore.getState().groups.find((g) => g.id === conn.groupId)
    : undefined;

  let enabled: boolean;
  if (conn.logSessions === "on") enabled = true;
  else if (conn.logSessions === "off") enabled = false;
  else if (group?.logSessions === "on") enabled = true;
  else if (group?.logSessions === "off") enabled = false;
  else enabled = logging.enabled;

  if (!enabled) return undefined;

  return {
    vaultPath: logging.vaultPath,
    connectionId: conn.id,
    group: group?.name,
    tags: ["slimrdm", "ssh", ...(conn.tags ?? [])],
    redactionPatterns: logging.redactionPatterns,
  };
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
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);
  const closePane = useAppStore((s) => s.closePane);

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
      lineHeight: 1.0,
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

    term.onData((data) => { ssh.sendInput(sessionId, data); });
    term.onResize(({ cols, rows }) => { ssh.resize(sessionId, cols, rows); });
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
          } else if (status === "closed") {
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
      term.options.lineHeight = 1.0;
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
      const { sshDefaults } = useSettingsStore.getState();
      const resolved = resolveCredentials(connection);
      const jumpHostParams = resolveJumpHostParams(connection);
      await ssh.connect({
        sessionId,
        host: connection.host,
        port: connection.port,
        username: resolved.username,
        authType: resolved.authType,
        credentialRef: resolved.credentialRef,
        privateKeyPath: resolved.privateKeyPath ?? connection.privateKeyPath,
        keepaliveInterval: sshDefaults.keepaliveInterval,
        connectTimeout: sshDefaults.connectTimeout,
        startupCommands: connection.startupCommands,
        initialCols: term?.cols,
        initialRows: term?.rows,
        jumpHostParams,
        allowLegacyCrypto: connection.allowLegacyCrypto,
        logging: resolveLogging(connection),
      });
    } catch (err) {
      const msg = String(err);
      term?.writeln(`\r\n\x1b[31m● Failed to connect: ${msg}\x1b[0m`);
      setSessionStatus(sessionId, "error", msg);
    }
  }, [sessionId, connection]);

  const fit = () => {
    fitAddonRef.current?.fit();
    if (termRef.current) termRef.current.refresh(0, termRef.current.rows - 1);
  };

  return { connect, term: termRef, fit };
}
