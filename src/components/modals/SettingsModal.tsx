import { X, Monitor, Server, Sliders, Database, Info } from "lucide-react";
import { useSettingsStore } from "../../store/settingsStore";
import { TERMINAL_THEMES, FONT_FAMILIES } from "../../utils/terminalThemes";
import { CursorStyle } from "../../types";
import clsx from "clsx";

interface Props {
  onClose: () => void;
}

type NavSection = "terminal";

const NAV: { id: NavSection | string; label: string; icon: React.ReactNode; available: boolean }[] = [
  { id: "terminal",     label: "Terminal",    icon: <Monitor size={14} />,  available: true },
  { id: "ssh-defaults", label: "SSH Defaults", icon: <Server size={14} />,  available: false },
  { id: "behavior",     label: "Behavior",    icon: <Sliders size={14} />, available: false },
  { id: "data",         label: "Data",        icon: <Database size={14} />, available: false },
  { id: "about",        label: "About",       icon: <Info size={14} />,    available: false },
];

export function SettingsModal({ onClose }: Props) {
  const activeSection: NavSection = "terminal";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="icon-btn" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav">
            {NAV.map((item) => (
              <button
                key={item.id}
                className={clsx(
                  "settings-nav-item",
                  item.id === activeSection && "settings-nav-item--active",
                  !item.available && "settings-nav-item--disabled",
                )}
                disabled={!item.available}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {activeSection === "terminal" && <TerminalSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function TerminalSection() {
  const { terminal, setTerminal } = useSettingsStore();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Terminal Appearance</h3>

      <div className="settings-group">
        <label className="settings-row-label">Font Family</label>
        <select
          className="field-input field-select"
          value={terminal.fontFamily}
          onChange={(e) => setTerminal({ fontFamily: e.target.value })}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className="settings-group">
        <label className="settings-row-label">Font Size</label>
        <div className="settings-stepper">
          <button
            className="stepper-btn"
            onClick={() => setTerminal({ fontSize: Math.max(8, terminal.fontSize - 1) })}
          >−</button>
          <span className="stepper-value">{terminal.fontSize}px</span>
          <button
            className="stepper-btn"
            onClick={() => setTerminal({ fontSize: Math.min(32, terminal.fontSize + 1) })}
          >+</button>
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-row-label">Scrollback Lines</label>
        <select
          className="field-input field-select settings-select-narrow"
          value={terminal.scrollback}
          onChange={(e) => setTerminal({ scrollback: Number(e.target.value) })}
        >
          {[1000, 5000, 10000, 50000, 100000].map((n) => (
            <option key={n} value={n}>{n.toLocaleString()}</option>
          ))}
        </select>
      </div>

      <div className="settings-group">
        <label className="settings-row-label">Cursor Style</label>
        <div className="cursor-style-toggle">
          {(["block", "bar", "underline"] as CursorStyle[]).map((s) => (
            <button
              key={s}
              className={clsx("cursor-btn", terminal.cursorStyle === s && "cursor-btn--active")}
              onClick={() => setTerminal({ cursorStyle: s })}
            >
              {s === "block" ? "█" : s === "bar" ? "▏" : "▁"}
              <span>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-row-label">Cursor Blink</label>
        <button
          className={clsx("toggle", terminal.cursorBlink && "toggle--on")}
          onClick={() => setTerminal({ cursorBlink: !terminal.cursorBlink })}
          role="switch"
          aria-checked={terminal.cursorBlink}
        >
          <span className="toggle-thumb" />
        </button>
      </div>

      <div className="settings-group settings-group--column">
        <label className="settings-row-label">Theme</label>
        <div className="theme-grid">
          {Object.entries(TERMINAL_THEMES).map(([key, entry]) => (
            <button
              key={key}
              className={clsx("theme-swatch", terminal.theme === key && "theme-swatch--active")}
              style={{ "--swatch-bg": entry.bg, "--swatch-accent": entry.accent } as React.CSSProperties}
              onClick={() => setTerminal({ theme: key })}
            >
              <span className="theme-swatch-preview">
                <span className="swatch-dot" style={{ background: entry.theme.red as string }} />
                <span className="swatch-dot" style={{ background: entry.theme.green as string }} />
                <span className="swatch-dot" style={{ background: entry.theme.blue as string }} />
              </span>
              <span className="theme-swatch-label">{entry.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
