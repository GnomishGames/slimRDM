import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import { TerminalSettings, SshDefaults, RdpDefaults, BehaviorSettings, LoggingSettings } from "../types";
import { applyAppTheme } from "../utils/appThemes";

export const DEFAULT_SSH_DEFAULTS: SshDefaults = {
  username: "",
  port: 22,
  keepaliveInterval: 60,
  connectTimeout: 15,
};

export const DEFAULT_RDP_DEFAULTS: RdpDefaults = {
  port: 3389,
  width: 1280,
  height: 800,
  performanceFlags: {
    disableWallpaper: true,
    disableFontSmoothing: false,
    disableAnimation: true,
    disableTheme: false,
    disableMenuAnimations: true,
    disableCursorShadow: false,
    disableCursorBlinking: false,
    enableDesktopComposition: false,
  },
  connectionQuality: "auto",
};

export const DEFAULT_BEHAVIOR: BehaviorSettings = {
  copyOnSelect: false,
  confirmCloseTab: false,
  autoReconnect: false,
};

export const DEFAULT_LOGGING: LoggingSettings = {
  enabled: false,
  vaultPath: "",
  redactionPatterns: [],
  ingestClaude: false,
};

export const DEFAULT_TERMINAL: TerminalSettings = {
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
  fontSize: 13,
  scrollback: 5000,
  cursorStyle: "block",
  cursorBlink: true,
  theme: "github-dark",
  renderer: "webgl",
};

interface SettingsState {
  terminal: TerminalSettings;
  appTheme: string;
  sshDefaults: SshDefaults;
  rdpDefaults: RdpDefaults;
  behavior: BehaviorSettings;
  logging: LoggingSettings;
  expandedGroupIds: string[];
  load: () => Promise<void>;
  setTerminal: (patch: Partial<TerminalSettings>) => void;
  setAppTheme: (theme: string) => void;
  setSshDefaults: (patch: Partial<SshDefaults>) => void;
  setRdpDefaults: (patch: Partial<RdpDefaults>) => void;
  setRdpPerformanceFlags: (patch: Partial<RdpDefaults["performanceFlags"]>) => void;
  setBehavior: (patch: Partial<BehaviorSettings>) => void;
  setLogging: (patch: Partial<LoggingSettings>) => void;
  setExpandedGroupIds: (ids: string[]) => void;
}

let _store: Store | null = null;
async function getStore() {
  if (!_store) _store = await Store.load("settings.json");
  return _store;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  terminal: DEFAULT_TERMINAL,
  appTheme: "github-dark",
  sshDefaults: DEFAULT_SSH_DEFAULTS,
  rdpDefaults: DEFAULT_RDP_DEFAULTS,
  behavior: DEFAULT_BEHAVIOR,
  logging: DEFAULT_LOGGING,
  expandedGroupIds: [],

  load: async () => {
    const s = await getStore();
    const savedTerminal = await s.get<TerminalSettings>("terminal");
    const savedAppTheme = await s.get<string>("appTheme");
    const savedSshDefaults = await s.get<SshDefaults>("sshDefaults");
    const savedRdpDefaults = await s.get<RdpDefaults>("rdpDefaults");
    const savedBehavior = await s.get<BehaviorSettings>("behavior");
    const savedLogging = await s.get<LoggingSettings>("logging");
    const savedExpandedGroupIds = await s.get<string[]>("expandedGroupIds");
    if (savedTerminal) set({ terminal: { ...DEFAULT_TERMINAL, ...savedTerminal } });
    if (savedSshDefaults) set({ sshDefaults: { ...DEFAULT_SSH_DEFAULTS, ...savedSshDefaults } });
    if (savedRdpDefaults) set({ rdpDefaults: { ...DEFAULT_RDP_DEFAULTS, ...savedRdpDefaults } });
    if (savedBehavior) set({ behavior: { ...DEFAULT_BEHAVIOR, ...savedBehavior } });
    if (savedLogging) set({ logging: { ...DEFAULT_LOGGING, ...savedLogging } });
    if (savedExpandedGroupIds) set({ expandedGroupIds: savedExpandedGroupIds });
    const appTheme = savedAppTheme ?? "github-dark";
    set({ appTheme });
    applyAppTheme(appTheme);
  },

  setTerminal: (patch) => {
    const next = { ...get().terminal, ...patch };
    set({ terminal: next });
    getStore().then((s) => { s.set("terminal", next); s.save(); });
  },

  setAppTheme: (theme) => {
    set({ appTheme: theme });
    applyAppTheme(theme);
    getStore().then((s) => { s.set("appTheme", theme); s.save(); });
  },

  setSshDefaults: (patch) => {
    const next = { ...get().sshDefaults, ...patch };
    set({ sshDefaults: next });
    getStore().then((s) => { s.set("sshDefaults", next); s.save(); });
  },

  setRdpDefaults: (patch) => {
    const next = { ...get().rdpDefaults, ...patch };
    set({ rdpDefaults: next });
    getStore().then((s) => { s.set("rdpDefaults", next); s.save(); });
  },

  setRdpPerformanceFlags: (patch) => {
    const current = get().rdpDefaults;
    const next = { ...current, performanceFlags: { ...current.performanceFlags, ...patch } };
    set({ rdpDefaults: next });
    getStore().then((s) => { s.set("rdpDefaults", next); s.save(); });
  },

  setBehavior: (patch) => {
    const next = { ...get().behavior, ...patch };
    set({ behavior: next });
    getStore().then((s) => { s.set("behavior", next); s.save(); });
  },

  setLogging: (patch) => {
    const next = { ...get().logging, ...patch };
    set({ logging: next });
    getStore().then((s) => { s.set("logging", next); s.save(); });
  },

  setExpandedGroupIds: (ids) => {
    set({ expandedGroupIds: ids });
    getStore().then((s) => { s.set("expandedGroupIds", ids); s.save(); });
  },
}));
