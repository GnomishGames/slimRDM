import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import { TerminalSettings } from "../types";

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
  load: () => Promise<void>;
  setTerminal: (patch: Partial<TerminalSettings>) => void;
}

let _store: Store | null = null;
async function getStore() {
  if (!_store) _store = await Store.load("settings.json");
  return _store;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  terminal: DEFAULT_TERMINAL,

  load: async () => {
    const s = await getStore();
    const saved = await s.get<TerminalSettings>("terminal");
    if (saved) set({ terminal: { ...DEFAULT_TERMINAL, ...saved } });
  },

  setTerminal: (patch) => {
    const next = { ...get().terminal, ...patch };
    set({ terminal: next });
    getStore().then((s) => { s.set("terminal", next); s.save(); });
  },
}));
