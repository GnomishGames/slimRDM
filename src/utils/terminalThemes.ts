import type { ITheme } from "@xterm/xterm";

export interface ThemeEntry {
  label: string;
  bg: string;
  accent: string;
  theme: ITheme;
}

export const TERMINAL_THEMES: Record<string, ThemeEntry> = {
  "github-dark": {
    label: "GitHub Dark",
    bg: "#0d1117",
    accent: "#58a6ff",
    theme: {
      background: "#0d1117", foreground: "#e6edf3", cursor: "#58a6ff",
      selectionBackground: "#264f78",
      black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
      blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
      brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364",
      brightYellow: "#e3b341", brightBlue: "#79c0ff", brightMagenta: "#d2a8ff",
      brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
    },
  },
  "dracula": {
    label: "Dracula",
    bg: "#282a36",
    accent: "#bd93f9",
    theme: {
      background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2",
      selectionBackground: "#44475a",
      black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
      blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
      brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94",
      brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df",
      brightCyan: "#a4ffff", brightWhite: "#ffffff",
    },
  },
  "one-dark": {
    label: "One Dark",
    bg: "#282c34",
    accent: "#61afef",
    theme: {
      background: "#282c34", foreground: "#abb2bf", cursor: "#528bff",
      selectionBackground: "#3e4451",
      black: "#3f4451", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
      blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
      brightBlack: "#4f5666", brightRed: "#be5046", brightGreen: "#98c379",
      brightYellow: "#d19a66", brightBlue: "#61afef", brightMagenta: "#c678dd",
      brightCyan: "#56b6c2", brightWhite: "#ffffff",
    },
  },
  "solarized-dark": {
    label: "Solarized Dark",
    bg: "#002b36",
    accent: "#268bd2",
    theme: {
      background: "#002b36", foreground: "#839496", cursor: "#839496",
      selectionBackground: "#073642",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75",
      brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  "nord": {
    label: "Nord",
    bg: "#2e3440",
    accent: "#88c0d0",
    theme: {
      background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9",
      selectionBackground: "#434c5e",
      black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
      blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
      brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb", brightWhite: "#eceff4",
    },
  },
  "tokyo-night": {
    label: "Tokyo Night",
    bg: "#1a1b26",
    accent: "#7aa2f7",
    theme: {
      background: "#1a1b26", foreground: "#c0caf5", cursor: "#c0caf5",
      selectionBackground: "#283457",
      black: "#15161e", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68",
      blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6",
      brightBlack: "#414868", brightRed: "#f7768e", brightGreen: "#9ece6a",
      brightYellow: "#e0af68", brightBlue: "#7aa2f7", brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff", brightWhite: "#c0caf5",
    },
  },
};

export function getTheme(key: string): ITheme {
  return (TERMINAL_THEMES[key] ?? TERMINAL_THEMES["github-dark"]).theme;
}

export const FONT_FAMILIES = [
  { label: "JetBrains Mono", value: "'JetBrains Mono', monospace" },
  { label: "Fira Code", value: "'Fira Code', monospace" },
  { label: "Cascadia Code", value: "'Cascadia Code', monospace" },
  { label: "Hack", value: "'Hack', monospace" },
  { label: "Source Code Pro", value: "'Source Code Pro', monospace" },
  { label: "System Monospace", value: "monospace" },
];
