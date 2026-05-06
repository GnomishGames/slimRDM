export interface AppThemeVars {
  "--bg-base": string;
  "--bg-surface": string;
  "--bg-elevated": string;
  "--bg-hover": string;
  "--border": string;
  "--border-subtle": string;
  "--text-primary": string;
  "--text-secondary": string;
  "--text-muted": string;
  "--accent": string;
  "--accent-dim": string;
  "--green": string;
  "--red": string;
  "--yellow": string;
}

export interface AppThemeEntry {
  label: string;
  colorScheme: "light" | "dark";
  vars: AppThemeVars;
}

export const APP_THEMES: Record<string, AppThemeEntry> = {
  "github-dark": {
    label: "GitHub Dark",
    colorScheme: "dark",
    vars: {
      "--bg-base": "#0d1117",
      "--bg-surface": "#161b22",
      "--bg-elevated": "#21262d",
      "--bg-hover": "#30363d",
      "--border": "#30363d",
      "--border-subtle": "#21262d",
      "--text-primary": "#e6edf3",
      "--text-secondary": "#8b949e",
      "--text-muted": "#6e7681",
      "--accent": "#58a6ff",
      "--accent-dim": "#1f6feb33",
      "--green": "#3fb950",
      "--red": "#ff7b72",
      "--yellow": "#d29922",
    },
  },
  "midnight": {
    label: "Midnight",
    colorScheme: "dark",
    vars: {
      "--bg-base": "#080c10",
      "--bg-surface": "#0d1117",
      "--bg-elevated": "#141a21",
      "--bg-hover": "#1c2430",
      "--border": "#1c2430",
      "--border-subtle": "#141a21",
      "--text-primary": "#e0e6ed",
      "--text-secondary": "#768390",
      "--text-muted": "#444c56",
      "--accent": "#388bfd",
      "--accent-dim": "#388bfd30",
      "--green": "#2ea043",
      "--red": "#da3633",
      "--yellow": "#9e6a03",
    },
  },
  "dracula": {
    label: "Dracula",
    colorScheme: "dark",
    vars: {
      "--bg-base": "#1e1f29",
      "--bg-surface": "#282a36",
      "--bg-elevated": "#343746",
      "--bg-hover": "#44475a",
      "--border": "#44475a",
      "--border-subtle": "#343746",
      "--text-primary": "#f8f8f2",
      "--text-secondary": "#a9a9b3",
      "--text-muted": "#6272a4",
      "--accent": "#bd93f9",
      "--accent-dim": "#bd93f930",
      "--green": "#50fa7b",
      "--red": "#ff5555",
      "--yellow": "#f1fa8c",
    },
  },
  "nord": {
    label: "Nord",
    colorScheme: "dark",
    vars: {
      "--bg-base": "#242933",
      "--bg-surface": "#2e3440",
      "--bg-elevated": "#3b4252",
      "--bg-hover": "#434c5e",
      "--border": "#434c5e",
      "--border-subtle": "#3b4252",
      "--text-primary": "#eceff4",
      "--text-secondary": "#d8dee9",
      "--text-muted": "#4c566a",
      "--accent": "#88c0d0",
      "--accent-dim": "#88c0d030",
      "--green": "#a3be8c",
      "--red": "#bf616a",
      "--yellow": "#ebcb8b",
    },
  },
  "catppuccin": {
    label: "Catppuccin",
    colorScheme: "dark",
    vars: {
      "--bg-base": "#11111b",
      "--bg-surface": "#1e1e2e",
      "--bg-elevated": "#313244",
      "--bg-hover": "#45475a",
      "--border": "#45475a",
      "--border-subtle": "#313244",
      "--text-primary": "#cdd6f4",
      "--text-secondary": "#bac2de",
      "--text-muted": "#585b70",
      "--accent": "#89b4fa",
      "--accent-dim": "#89b4fa30",
      "--green": "#a6e3a1",
      "--red": "#f38ba8",
      "--yellow": "#f9e2af",
    },
  },
  "one-dark": {
    label: "One Dark",
    colorScheme: "dark",
    vars: {
      "--bg-base": "#21252b",
      "--bg-surface": "#282c34",
      "--bg-elevated": "#2c313a",
      "--bg-hover": "#3e4451",
      "--border": "#3e4451",
      "--border-subtle": "#2c313a",
      "--text-primary": "#abb2bf",
      "--text-secondary": "#828997",
      "--text-muted": "#5c6370",
      "--accent": "#61afef",
      "--accent-dim": "#61afef30",
      "--green": "#98c379",
      "--red": "#e06c75",
      "--yellow": "#e5c07b",
    },
  },
  "github-light": {
    label: "GitHub Light",
    colorScheme: "light",
    vars: {
      "--bg-base": "#ffffff",
      "--bg-surface": "#f6f8fa",
      "--bg-elevated": "#eaeef2",
      "--bg-hover": "#d0d7de",
      "--border": "#d0d7de",
      "--border-subtle": "#eaeef2",
      "--text-primary": "#1f2328",
      "--text-secondary": "#656d76",
      "--text-muted": "#9198a1",
      "--accent": "#0969da",
      "--accent-dim": "#0969da22",
      "--green": "#1a7f37",
      "--red": "#d1242f",
      "--yellow": "#9a6700",
    },
  },
  "solarized-light": {
    label: "Solarized Light",
    colorScheme: "light",
    vars: {
      "--bg-base": "#fdf6e3",
      "--bg-surface": "#eee8d5",
      "--bg-elevated": "#e0d9c6",
      "--bg-hover": "#d3ccb8",
      "--border": "#c4bba6",
      "--border-subtle": "#ddd6c2",
      "--text-primary": "#586e75",
      "--text-secondary": "#657b83",
      "--text-muted": "#93a1a1",
      "--accent": "#268bd2",
      "--accent-dim": "#268bd222",
      "--green": "#859900",
      "--red": "#dc322f",
      "--yellow": "#b58900",
    },
  },
};

export function applyAppTheme(key: string): void {
  const entry = APP_THEMES[key] ?? APP_THEMES["github-dark"];
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(entry.vars)) {
    root.style.setProperty(prop, value);
  }
  root.style.setProperty("--color-scheme", entry.colorScheme);
}
