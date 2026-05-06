export type ConnectionType = "ssh" | "rdp";
export type AuthType = "password" | "public_key" | "agent";
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
}

export interface Group {
  id: string;
  name: string;
  parentId?: string;
  color?: string;
  icon?: string;
}

export interface Session {
  id: string;
  connectionId: string;
  connection: Connection;
  status: SessionStatus;
  openedAt: number;
  error?: string;
}

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
}
