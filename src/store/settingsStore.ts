import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import { TerminalSettings } from "../types";
import { applyAppTheme } from "../utils/appThemes";

export const DEFAULT_TERMINAL: TerminalSettings = {
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
  fontSize: 13,
  scrollback: 5000,
  cursorStyle: "block",
  cursorBlink: true,
  theme: "github-dark",
};

interface SettingsState {
  terminal: TerminalSettings;
  appTheme: string;
  load: () => Promise<void>;
  setTerminal: (patch: Partial<TerminalSettings>) => void;
  setAppTheme: (theme: string) => void;
}

let _store: Store | null = null;
async function getStore() {
  if (!_store) _store = await Store.load("settings.json");
  return _store;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  terminal: DEFAULT_TERMINAL,
  appTheme: "github-dark",

  load: async () => {
    const s = await getStore();
    const savedTerminal = await s.get<TerminalSettings>("terminal");
    const savedAppTheme = await s.get<string>("appTheme");
    if (savedTerminal) set({ terminal: { ...DEFAULT_TERMINAL, ...savedTerminal } });
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
}));
