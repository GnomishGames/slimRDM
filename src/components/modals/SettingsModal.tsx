import { useState, useEffect, useRef } from "react";
import { X, Palette, Server, Monitor, Sliders, Database, Info, Github, ExternalLink, Upload, Download } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { useSettingsStore } from "../../store/settingsStore";
import { useAppStore } from "../../store/appStore";
import { TERMINAL_THEMES, FONT_FAMILIES } from "../../utils/terminalThemes";
import { APP_THEMES } from "../../utils/appThemes";
import { CursorStyle, RdpDefaults } from "../../types";
import { dialog, data, updates, UpdateInfo } from "../../utils/tauri";
import clsx from "clsx";

interface Props {
  onClose: () => void;
}

type NavSection = "appearance" | "ssh-defaults" | "rdp-defaults" | "behavior" | "data" | "about";

const NAV: { id: NavSection | string; label: string; icon: React.ReactNode; available: boolean }[] = [
  { id: "appearance",   label: "Appearance",   icon: <Palette size={14} />,  available: true },
  { id: "ssh-defaults", label: "SSH Defaults",  icon: <Server size={14} />,  available: true },
  { id: "rdp-defaults", label: "RDP Defaults",  icon: <Monitor size={14} />, available: true },
  { id: "behavior",     label: "Behavior",      icon: <Sliders size={14} />, available: true },
  { id: "data",         label: "Data",          icon: <Database size={14} />, available: true },
  { id: "about",        label: "About",         icon: <Info size={14} />,    available: true },
];

export function SettingsModal({ onClose }: Props) {
  const [activeSection, setActiveSection] = useState<NavSection>("appearance");
  const mouseDownOnBackdrop = useRef(false);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={() => { if (mouseDownOnBackdrop.current) onClose(); }}
    >
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
                onClick={() => item.available && setActiveSection(item.id as NavSection)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {activeSection === "appearance" && <AppearanceSection />}
            {activeSection === "ssh-defaults" && <SshDefaultsSection />}
            {activeSection === "rdp-defaults" && <RdpDefaultsSection />}
            {activeSection === "behavior" && <BehaviorSection />}
            {activeSection === "data" && <DataSection />}
            {activeSection === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SshDefaultsSection() {
  const { sshDefaults, setSshDefaults } = useSettingsStore();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">SSH Defaults</h3>
      <p className="settings-section-desc">Applied when creating new SSH connections.</p>

      <div className="settings-group">
        <label className="settings-row-label">Default Username</label>
        <input
          className="field-input"
          placeholder="e.g. admin"
          value={sshDefaults.username}
          onChange={(e) => setSshDefaults({ username: e.target.value })}
        />
      </div>

      <div className="settings-group">
        <label className="settings-row-label">Default Port</label>
        <div className="settings-stepper">
          <button className="stepper-btn" onClick={() => setSshDefaults({ port: Math.max(1, sshDefaults.port - 1) })}>−</button>
          <span className="stepper-value">{sshDefaults.port}</span>
          <button className="stepper-btn" onClick={() => setSshDefaults({ port: Math.min(65535, sshDefaults.port + 1) })}>+</button>
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-row-label">Keepalive Interval</label>
        <select
          className="field-input field-select settings-select-narrow"
          value={sshDefaults.keepaliveInterval}
          onChange={(e) => setSshDefaults({ keepaliveInterval: Number(e.target.value) })}
        >
          <option value={0}>Disabled</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
          <option value={120}>2m</option>
          <option value={300}>5m</option>
        </select>
      </div>

      <div className="settings-group">
        <label className="settings-row-label">Connect Timeout</label>
        <select
          className="field-input field-select settings-select-narrow"
          value={sshDefaults.connectTimeout}
          onChange={(e) => setSshDefaults({ connectTimeout: Number(e.target.value) })}
        >
          <option value={0}>None</option>
          <option value={5}>5s</option>
          <option value={10}>10s</option>
          <option value={15}>15s</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
        </select>
      </div>
    </div>
  );
}

function RdpDefaultsSection() {
  const { rdpDefaults, setRdpDefaults, setRdpPerformanceFlags } = useSettingsStore();

  const qualityPresets: { id: RdpDefaults["connectionQuality"]; label: string; desc: string }[] = [
    { id: "auto", label: "Auto-detect", desc: "Let Windows negotiate" },
    { id: "lan", label: "LAN (High-speed)", desc: "Disable most optimizations" },
    { id: "broadband", label: "Broadband", desc: "Balanced for 10+ Mbps" },
    { id: "modem", label: "Modem (Low-speed)", desc: "Maximum compression" },
  ];

  const performanceOptions = [
    { key: "disableWallpaper" as const, label: "Disable desktop background" },
    { key: "disableFontSmoothing" as const, label: "Disable font smoothing" },
    { key: "disableAnimation" as const, label: "Disable animations" },
    { key: "disableTheme" as const, label: "Disable visual styles" },
    { key: "disableMenuAnimations" as const, label: "Disable menu animations" },
    { key: "disableCursorShadow" as const, label: "Disable cursor shadow" },
    { key: "disableCursorBlinking" as const, label: "Disable cursor blinking" },
    { key: "enableDesktopComposition" as const, label: "Enable desktop composition" },
  ];

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">RDP Defaults</h3>
      <p className="settings-section-desc">Applied when creating new RDP connections.</p>

      {/* ── Connection Quality ─────────────────────── */}
      <p className="settings-subsection-title">Connection Quality</p>
      <div className="settings-group settings-group--column">
        <div className="rdp-quality-grid">
          {qualityPresets.map((preset) => (
            <button
              key={preset.id}
              className={clsx("rdp-quality-btn", rdpDefaults.connectionQuality === preset.id && "rdp-quality-btn--active")}
              onClick={() => setRdpDefaults({ connectionQuality: preset.id })}
            >
              <span className="rdp-quality-label">{preset.label}</span>
              <span className="rdp-quality-desc">{preset.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Performance Flags ─────────────────────── */}
      <p className="settings-subsection-title" style={{ marginTop: 16 }}>Performance Options</p>
      <p className="settings-section-desc">Disable visual features to improve responsiveness.</p>
      <div className="settings-group settings-group--column">
        {performanceOptions.map((opt) => (
          <label key={opt.key} className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={rdpDefaults.performanceFlags[opt.key]}
              onChange={(e) => setRdpPerformanceFlags({ [opt.key]: e.target.checked })}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>

      {/* ── Default Size ─────────────────────────── */}
      <p className="settings-subsection-title" style={{ marginTop: 16 }}>Default Size</p>
      <div className="settings-row-inline">
        <div className="settings-group">
          <label className="settings-row-label">Width</label>
          <div className="settings-stepper">
            <button className="stepper-btn" onClick={() => setRdpDefaults({ width: Math.max(800, rdpDefaults.width - 64) })}>−</button>
            <span className="stepper-value">{rdpDefaults.width}</span>
            <button className="stepper-btn" onClick={() => setRdpDefaults({ width: Math.min(3840, rdpDefaults.width + 64) })}>+</button>
          </div>
        </div>
        <div className="settings-group">
          <label className="settings-row-label">Height</label>
          <div className="settings-stepper">
            <button className="stepper-btn" onClick={() => setRdpDefaults({ height: Math.max(600, rdpDefaults.height - 64) })}>−</button>
            <span className="stepper-value">{rdpDefaults.height}</span>
            <button className="stepper-btn" onClick={() => setRdpDefaults({ height: Math.min(2160, rdpDefaults.height + 64) })}>+</button>
          </div>
        </div>
      </div>

      {/* ── Default Port ──────────────────────────── */}
      <div className="settings-group">
        <label className="settings-row-label">Default Port</label>
        <div className="settings-stepper">
          <button className="stepper-btn" onClick={() => setRdpDefaults({ port: Math.max(1, rdpDefaults.port - 1) })}>−</button>
          <span className="stepper-value">{rdpDefaults.port}</span>
          <button className="stepper-btn" onClick={() => setRdpDefaults({ port: Math.min(65535, rdpDefaults.port + 1) })}>+</button>
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { terminal, setTerminal, appTheme, setAppTheme } = useSettingsStore();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Appearance</h3>

      {/* ── App Theme ───────────────────────────── */}
      <p className="settings-subsection-title">App Theme</p>

      <div className="settings-group settings-group--column">
        <div className="theme-grid">
          {Object.entries(APP_THEMES).map(([key, entry]) => (
            <button
              key={key}
              className={clsx("theme-swatch", appTheme === key && "theme-swatch--active")}
              style={{
                "--swatch-bg": entry.vars["--bg-surface"],
                "--swatch-accent": entry.vars["--accent"],
              } as React.CSSProperties}
              onClick={() => setAppTheme(key)}
            >
              <span className="theme-swatch-preview">
                <span className="swatch-dot" style={{ background: entry.vars["--accent"] }} />
                <span className="swatch-dot" style={{ background: entry.vars["--green"] }} />
                <span className="swatch-dot" style={{ background: entry.vars["--red"] }} />
              </span>
              <span className="theme-swatch-label">{entry.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Terminal ────────────────────────────── */}
      <p className="settings-subsection-title" style={{ marginTop: 16 }}>Terminal</p>

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
          <button className="stepper-btn" onClick={() => setTerminal({ fontSize: Math.max(8, terminal.fontSize - 1) })}>−</button>
          <span className="stepper-value">{terminal.fontSize}px</span>
          <button className="stepper-btn" onClick={() => setTerminal({ fontSize: Math.min(32, terminal.fontSize + 1) })}>+</button>
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
        <label className="settings-row-label">Terminal Colors</label>
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

function BehaviorSection() {
  const { behavior, setBehavior } = useSettingsStore();

  const rows: { key: keyof typeof behavior; label: string; help: string }[] = [
    {
      key: "copyOnSelect",
      label: "Copy on Select",
      help: "Automatically copy terminal selections to clipboard.",
    },
    {
      key: "confirmCloseTab",
      label: "Confirm Before Closing Tab",
      help: "Ask for confirmation when closing an active session tab.",
    },
    {
      key: "autoReconnect",
      label: "Auto-Reconnect",
      help: "Automatically reconnect SSH sessions after unexpected disconnects.",
    },
  ];

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Behavior</h3>

      {rows.map(({ key, label, help }) => (
        <div key={key}>
          <div className="settings-group">
            <label className="settings-row-label">{label}</label>
            <button
              className={clsx("toggle", behavior[key] && "toggle--on")}
              onClick={() => setBehavior({ [key]: !behavior[key] })}
              role="switch"
              aria-checked={behavior[key]}
            >
              <span className="toggle-thumb" />
            </button>
          </div>
          <p className="settings-help-text">{help}</p>
        </div>
      ))}
    </div>
  );
}

function DataSection() {
  const { connections, groups, loadConnections, loadGroups } = useAppStore();
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [status, setStatus] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    const path = await dialog.saveFile("Export connections", "slimrdm-backup.json");
    if (!path) return;
    setBusy(true);
    setStatus(null);
    try {
      await data.export(path as string);
      setStatus({ type: "ok", msg: `Exported ${connections.length} connection(s) and ${groups.length} group(s).` });
    } catch (err) {
      setStatus({ type: "err", msg: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    const path = await dialog.pickFile("Import connections");
    if (!path) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await data.import(path as string, importMode === "replace");
      await Promise.all([loadConnections(), loadGroups()]);
      setStatus({ type: "ok", msg: `Imported ${result.connectionsAdded} connection(s) and ${result.groupsAdded} group(s).` });
    } catch (err) {
      setStatus({ type: "err", msg: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Data</h3>

      <div className="settings-group settings-group--column">
        <label className="settings-row-label">Export</label>
        <p className="settings-help-text">
          Saves all connections and groups to a JSON file. Passwords are stored in the OS keyring
          and are not included.
        </p>
        <button className="btn btn--ghost data-action-btn" onClick={handleExport} disabled={busy}>
          <Download size={13} /> Export connections…
        </button>
      </div>

      <div className="settings-group settings-group--column" style={{ marginTop: 8 }}>
        <label className="settings-row-label">Import</label>
        <p className="settings-help-text">Load connections from a previously exported JSON file.</p>
        <div className="data-import-mode">
          {(["merge", "replace"] as const).map((m) => (
            <label key={m} className="data-radio-label">
              <input
                type="radio"
                name="import-mode"
                value={m}
                checked={importMode === m}
                onChange={() => setImportMode(m)}
              />
              {m === "merge" ? "Merge (skip duplicates)" : "Replace all"}
            </label>
          ))}
        </div>
        <button className="btn btn--ghost data-action-btn" onClick={handleImport} disabled={busy}>
          <Upload size={13} /> Import connections…
        </button>
      </div>

      {status && (
        <p className={clsx("data-status", status.type === "err" && "data-status--err")}>
          {status.msg}
        </p>
      )}
    </div>
  );
}

type UpdateState = "idle" | "checking" | "up-to-date" | "available" | "error";

function AboutSection() {
  const [version, setVersion] = useState<string>("…");
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);

  const openGitHub = () => openUrl("https://github.com/GnomishGames/slimRDM");

  const handleCheckUpdates = async () => {
    setUpdateState("checking");
    setUpdateError(null);
    try {
      const info = await updates.check();
      setUpdateInfo(info);
      setUpdateState(info.hasUpdate ? "available" : "up-to-date");
    } catch (err) {
      setUpdateError(String(err));
      setUpdateState("error");
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">About</h3>

      <div className="about-hero">
        <span className="about-app-name">SlimRDM</span>
        <span className="about-version">v{version}</span>
      </div>

      <div className="about-update-row">
        {updateState === "idle" && (
          <button className="btn btn--ghost about-update-btn" onClick={handleCheckUpdates}>
            Check for Updates
          </button>
        )}
        {updateState === "checking" && (
          <span className="about-update-status">Checking…</span>
        )}
        {updateState === "up-to-date" && (
          <span className="about-update-status about-update-status--ok">You're up to date</span>
        )}
        {updateState === "error" && (
          <span className="about-update-status about-update-status--err">{updateError}</span>
        )}
        {updateState === "available" && updateInfo && (
          <div className="about-update-available">
            <span className="about-update-badge">v{updateInfo.latestVersion} available</span>
            {updateInfo.downloadUrl ? (
              <button
                className="btn btn--primary about-update-btn"
                onClick={() => openUrl(updateInfo.downloadUrl!)}
              >
                <Download size={13} /> Download
              </button>
            ) : (
              <button className="btn btn--primary about-update-btn" onClick={openGitHub}>
                <ExternalLink size={13} /> View Release
              </button>
            )}
          </div>
        )}
        {(updateState === "up-to-date" || updateState === "error" || updateState === "available") && (
          <button className="about-recheck-btn" onClick={handleCheckUpdates}>Re-check</button>
        )}
      </div>

      <button className="about-github-btn" onClick={openGitHub}>
        <Github size={14} />
        GnomishGames/slimRDM
        <ExternalLink size={12} className="about-external-icon" />
      </button>

      <div className="about-block">
        <p className="about-block-title">Built with Claude Sonnet</p>
        <p className="about-block-body">
          This project was designed and written entirely with Claude Sonnet (Anthropic). Every feature,
          component, and line of Rust was crafted through conversation — no manual coding required.
        </p>
      </div>

      <div className="about-block">
        <p className="about-block-title">Tech stack</p>
        <ul className="about-stack-list">
          <li><span className="about-stack-name">Tauri 2</span> — cross-platform app shell</li>
          <li><span className="about-stack-name">Rust</span> — backend & SSH/RDP protocol</li>
          <li><span className="about-stack-name">React 18 + TypeScript</span> — UI</li>
          <li><span className="about-stack-name">russh</span> — pure-Rust SSH client</li>
          <li><span className="about-stack-name">ironrdp</span> — pure-Rust RDP client (Wayland-compatible)</li>
          <li><span className="about-stack-name">xterm.js</span> — terminal emulator</li>
        </ul>
      </div>

      <p className="about-license">Released under the MIT License.</p>
    </div>
  );
}