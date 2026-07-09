export type ConnectionType = "ssh" | "rdp" | "trm";
export type AuthType = "password" | "public_key" | "agent";
export type LogMode = "inherit" | "on" | "off";
export type SessionStatus = "connecting" | "connected" | "disconnected" | "error";
export type CursorStyle = "block" | "bar" | "underline";

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  theme: string;
}

export interface Connection {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  connectionType: ConnectionType;
  groupId?: string;
  authType: AuthType;
  privateKeyPath?: string;
  credentialRef?: string;
  notes?: string;
  tags: string[];
  createdAt: number;
  lastConnected?: number;
  useGroupCredentials?: boolean;
  jumpHostId?: string;
  workingDirectory?: string;
  shellPath?: string;
  startupCommands?: string;
  autoConnect?: boolean;
  logSessions?: LogMode;
  allowLegacyCrypto?: boolean;
}

export interface Category {
  id: string;
  name: string;
}

export interface Group {
  id: string;
  name: string;
  parentId?: string;
  color?: string;
  icon?: string;
  username?: string;
  credentialRef?: string;
  authType?: AuthType;
  privateKeyPath?: string;
  categoryId?: string;
  logSessions?: LogMode;
}

export interface Session {
  id: string;
  connectionId: string;
  connection: Connection;
  status: SessionStatus;
  openedAt: number;
  error?: string;
  tabId: string;
}

export interface PaneLeaf {
  type: "leaf";
  sessionId: string;
}

export interface PaneSplit {
  type: "split";
  // vertical = left|right (vertical divider line)
  // horizontal = top|bottom (horizontal divider line)
  direction: "vertical" | "horizontal";
  ratio: number; // 0–1, fraction of space given to `first`
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface RdpDefaults {
  port: number;
  width: number;
  height: number;
  performanceFlags: {
    disableWallpaper: boolean;
    disableFontSmoothing: boolean;
    disableAnimation: boolean;
    disableTheme: boolean;
    disableMenuAnimations: boolean;
    disableCursorShadow: boolean;
    disableCursorBlinking: boolean;
    enableDesktopComposition: boolean;
  };
  connectionQuality: "auto" | "lan" | "broadband" | "modem";
}

export interface SshDefaults {
  username: string;
  port: number;
  keepaliveInterval: number; // seconds; 0 = disabled
  connectTimeout: number;    // seconds
}

export interface BehaviorSettings {
  copyOnSelect: boolean;
  confirmCloseTab: boolean;
  autoReconnect: boolean;
}

export interface LoggingSettings {
  enabled: boolean;
  vaultPath: string;
  redactionPatterns: string[];
  ingestClaude: boolean;
}

/// Result of a Claude session sync run.
export interface SyncStats {
  scanned: number;
  written: number;
}

/// Resolved logging parameters sent to the backend on connect.
export interface SessionLogParams {
  vaultPath: string;
  connectionId: string;
  group?: string;
  tags: string[];
  redactionPatterns: string[];
}

export type TunnelStatus = "connecting" | "active" | "stopped" | "error";

export interface TunnelConfig {
  id: string;
  name: string;
  jumpHostId: string;
  remoteHost: string;
  remotePort: number;
  localPort: number;
  createdAt: number;
}

export interface TunnelRuntime {
  status: TunnelStatus;
  activeLocalPort?: number;
  error?: string;
}

export interface NewConnectionForm {
  label: string;
  host: string;
  port: number;
  username: string;
  connectionType: ConnectionType;
  groupId?: string;
  authType: AuthType;
  privateKeyPath?: string;
  password?: string;
  notes?: string;
  tags: string[];
  workingDirectory?: string;
  shellPath?: string;
  startupCommands?: string;
  autoConnect?: boolean;
  logSessions?: LogMode;
  allowLegacyCrypto?: boolean;
}
