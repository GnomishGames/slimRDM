import { useState, useRef } from "react";
import { X, Monitor, Terminal } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { credentials, dialog } from "../../utils/tauri";
import { FolderOpen } from "lucide-react";
import { Group } from "../../types";
import { Connection, ConnectionType, AuthType, LogMode } from "../../types";
import clsx from "clsx";

interface Props {
  onClose: () => void;
  editing?: Connection;
  prefill?: Connection;
}

const DEFAULTS: Record<ConnectionType, { port: number; authType: AuthType }> = {
  ssh: { port: 22, authType: "password" },
  rdp: { port: 3389, authType: "password" },
  trm: { port: 0, authType: "password" },
};

export function AddConnectionModal({ onClose, editing, prefill }: Props) {
  const { addConnection, updateConnection, groups } = useAppStore();
  const mouseDownOnBackdrop = useRef(false);
  const sshDefaults = useSettingsStore((s) => s.sshDefaults);
  const isEdit = !!editing;
  const source = editing ?? prefill;

  const [connType, setConnType] = useState<ConnectionType>(source?.connectionType ?? "ssh");
  const [label, setLabel] = useState(prefill ? `${prefill.label} (copy)` : (editing?.label ?? ""));
  const [host, setHost] = useState(source?.host ?? "");
  const [port, setPort] = useState(source?.port ?? (connType === "ssh" ? sshDefaults.port : DEFAULTS.rdp.port));
  const [username, setUsername] = useState(source?.username ?? (connType === "ssh" ? sshDefaults.username : ""));
  const [authType, setAuthType] = useState<AuthType>(source?.authType ?? "password");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState(source?.privateKeyPath ?? "");
  const [groupId, setGroupId] = useState<string>(source?.groupId ?? "");
  const [useGroupCredentials, setUseGroupCredentials] = useState(source?.useGroupCredentials ?? false);
  const [jumpHostId, setJumpHostId] = useState<string>(source?.jumpHostId ?? "");
  const [workingDirectory, setWorkingDirectory] = useState(source?.workingDirectory ?? "");
  const [shellPath, setShellPath] = useState(source?.shellPath ?? "");
  const [startupCommands, setStartupCommands] = useState(source?.startupCommands ?? "");
  const [allowLegacyCrypto, setAllowLegacyCrypto] = useState(source?.allowLegacyCrypto ?? false);
  const [autoConnect, setAutoConnect] = useState(source?.autoConnect ?? false);
  const [logSessions, setLogSessions] = useState<LogMode>(source?.logSessions ?? "inherit");
  const [notes, setNotes] = useState(source?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { connections } = useAppStore();
  const sshConnections = connections.filter(
    (c) => c.connectionType === "ssh" && c.id !== editing?.id
  );

  const selectedGroup = groups.find((g: Group) => g.id === groupId);
  const groupHasCredentials = !!(selectedGroup?.credentialRef || selectedGroup?.privateKeyPath);

  // Password starts empty on edit — user re-enters rather than
  // round-tripping the secret through the webview.

  const switchType = (t: ConnectionType) => {
    setConnType(t);
    const prevDefault = connType === "ssh" ? sshDefaults.port : DEFAULTS[connType].port;
    if (port === prevDefault) setPort(t === "ssh" ? sshDefaults.port : DEFAULTS[t].port);
    if (!isEdit) {
      setAuthType(DEFAULTS[t].authType);
      if (t === "ssh" && sshDefaults.username) setUsername(sshDefaults.username);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!label.trim()) e.label = "Required";
    if (connType !== "trm") {
      if (!host.trim()) e.host = "Required";
      if (!port || port < 1 || port > 65535) e.port = "1–65535";
      if (!username.trim() && !useGroupCredentials) e.username = "Required";
      if (authType === "password" && !isEdit && !password && !useGroupCredentials) e.password = "Required";
      if (authType === "public_key" && !privateKeyPath.trim() && !useGroupCredentials) e.privateKeyPath = "Required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      let credentialRef = editing?.credentialRef;

      if (authType === "password") {
        if (!credentialRef) credentialRef = crypto.randomUUID();
        if (password) {
          await credentials.save(credentialRef, password);
        }
      } else {
        // Auth type changed away from password — remove old credential
        if (editing?.credentialRef) {
          await credentials.delete(editing.credentialRef).catch(() => {});
        }
        credentialRef = undefined;
      }

      const effectiveGroupCredentials = useGroupCredentials && groupHasCredentials;

      const isTrm = connType === "trm";

      const effectiveStartupCommands = connType !== "rdp" ? startupCommands.trim() || undefined : undefined;

      if (isEdit) {
        await updateConnection({
          ...editing,
          label: label.trim(),
          host: isTrm ? "" : host.trim(),
          port: isTrm ? 0 : port,
          username: isTrm ? "" : username.trim(),
          connectionType: connType,
          authType,
          groupId: groupId || undefined,
          privateKeyPath: authType === "public_key" ? privateKeyPath.trim() : undefined,
          credentialRef: isTrm ? undefined : credentialRef,
          notes: notes.trim() || undefined,
          useGroupCredentials: isTrm ? false : effectiveGroupCredentials,
          jumpHostId: isTrm ? undefined : jumpHostId || undefined,
          workingDirectory: isTrm ? workingDirectory.trim() || undefined : undefined,
          shellPath: isTrm ? shellPath.trim() || undefined : undefined,
          startupCommands: effectiveStartupCommands,
          autoConnect,
          logSessions,
          allowLegacyCrypto: connType === "ssh" ? allowLegacyCrypto : false,
        });
      } else {
        await addConnection({
          label: label.trim(),
          host: isTrm ? "" : host.trim(),
          port: isTrm ? 0 : port,
          username: isTrm ? "" : username.trim(),
          connectionType: connType,
          authType,
          groupId: groupId || undefined,
          privateKeyPath: authType === "public_key" ? privateKeyPath.trim() : undefined,
          credentialRef: isTrm ? undefined : credentialRef,
          notes: notes.trim() || undefined,
          tags: [],
          useGroupCredentials: isTrm ? false : effectiveGroupCredentials,
          jumpHostId: isTrm ? undefined : jumpHostId || undefined,
          workingDirectory: isTrm ? workingDirectory.trim() || undefined : undefined,
          shellPath: isTrm ? shellPath.trim() || undefined : undefined,
          startupCommands: effectiveStartupCommands,
          autoConnect,
          logSessions,
          allowLegacyCrypto: connType === "ssh" ? allowLegacyCrypto : false,
        });
      }
      onClose();
    } catch (err) {
      setErrors({ _form: String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={() => { if (mouseDownOnBackdrop.current) onClose(); }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{isEdit ? "Edit Connection" : prefill ? "Duplicate Connection" : "New Connection"}</span>
          <button className="icon-btn" onClick={onClose}><X size={15} /></button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="field-row">
            <label className="field-label">Type</label>
            <div className="type-toggle">
              <button type="button" className={clsx("type-btn", connType === "ssh" && "type-btn--active")} onClick={() => switchType("ssh")}>
                <Terminal size={13} /> SSH
              </button>
              <button type="button" className={clsx("type-btn", connType === "rdp" && "type-btn--active")} onClick={() => switchType("rdp")}>
                <Monitor size={13} /> RDP
              </button>
              <button type="button" className={clsx("type-btn", connType === "trm" && "type-btn--active")} onClick={() => switchType("trm")}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: -1 }}>$_</span> TRM
              </button>
            </div>
          </div>

          <Field label="Label" error={errors.label}>
            <input className={clsx("field-input", errors.label && "field-input--error")} placeholder="My Server" value={label} onChange={e => setLabel(e.target.value)} autoFocus />
          </Field>

          {connType === "trm" ? (
            <>
              <Field label="Directory">
                <div className="field-browse">
                  <input
                    className="field-input"
                    placeholder="~/Documents (leave blank for home)"
                    value={workingDirectory}
                    onChange={e => setWorkingDirectory(e.target.value)}
                  />
                  <button type="button" className="btn btn--ghost btn--icon" onClick={async () => {
                    const picked = await dialog.pickDirectory("Select working directory");
                    if (picked) setWorkingDirectory(picked as string);
                  }}>
                    <FolderOpen size={14} />
                  </button>
                </div>
              </Field>
              <Field label="Shell">
                <input
                  className="field-input"
                  placeholder="Default system shell (e.g. pwsh, cmd.exe, /bin/zsh)"
                  value={shellPath}
                  onChange={e => setShellPath(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <div className="field-row-group">
                <Field label="Host" error={errors.host} grow>
                  <input className={clsx("field-input", errors.host && "field-input--error")} placeholder="192.168.1.1" value={host} onChange={e => setHost(e.target.value)} />
                </Field>
                <Field label="Port" error={errors.port} width={80}>
                  <input className={clsx("field-input", errors.port && "field-input--error")} type="number" value={port} onChange={e => setPort(Number(e.target.value))} />
                </Field>
              </div>

              {!useGroupCredentials && (
                <Field label="Username" error={errors.username}>
                  <input className={clsx("field-input", errors.username && "field-input--error")} placeholder="admin" value={username} onChange={e => setUsername(e.target.value)} />
                </Field>
              )}
            </>
          )}

          {!useGroupCredentials && connType === "ssh" && (
            <div className="field-row">
              <label className="field-label">Auth</label>
              <div className="auth-tabs">
                {(["password", "public_key", "agent"] as AuthType[]).map(a => (
                  <button key={a} type="button" className={clsx("auth-tab", authType === a && "auth-tab--active")} onClick={() => setAuthType(a)}>
                    {a === "public_key" ? "Key" : a === "agent" ? "Agent" : "Password"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!useGroupCredentials && authType === "password" && connType !== "trm" && (
            <Field label={"Password"} error={errors.password}>
              <input className={clsx("field-input", errors.password && "field-input--error")} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
            </Field>
          )}

          {!useGroupCredentials && authType === "public_key" && connType !== "trm" && (
            <Field label="Key path" error={errors.privateKeyPath}>
              <div className="field-browse">
                <input className={clsx("field-input", errors.privateKeyPath && "field-input--error")} placeholder="~/.ssh/id_rsa" value={privateKeyPath} onChange={e => setPrivateKeyPath(e.target.value)} />
                <button type="button" className="btn btn--ghost btn--icon" onClick={async () => {
                  const picked = await dialog.pickFile("Select SSH private key");
                  if (picked) setPrivateKeyPath(picked as string);
                }}>
                  <FolderOpen size={14} />
                </button>
              </div>
            </Field>
          )}

          {groups.length > 0 && (
            <Field label="Group">
              <select className="field-input field-select" value={groupId} onChange={e => { setGroupId(e.target.value); setUseGroupCredentials(false); }}>
                <option value="">No group</option>
                {groups.map((g: Group) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>
          )}

          {groupHasCredentials && connType !== "trm" && (
            <div className="field-row">
              <label className="field-label">Group credentials</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className={clsx("toggle", useGroupCredentials && "toggle--on")}
                  onClick={() => setUseGroupCredentials((v) => !v)}
                >
                  <span className="toggle-thumb" />
                </button>
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {useGroupCredentials ? "Using group credentials" : "Using own credentials"}
                </span>
              </div>
            </div>
          )}

          {sshConnections.length > 0 && connType !== "trm" && (
            <Field label="Jump host">
              <select
                className="field-input field-select"
                value={jumpHostId}
                onChange={e => setJumpHostId(e.target.value)}
              >
                <option value="">None</option>
                {sshConnections.map((c) => (
                  <option key={c.id} value={c.id}>{c.label} ({c.host})</option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Notes">
            <textarea className="field-input field-textarea" placeholder="Optional notes..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </Field>

          {connType !== "rdp" && (
            <Field label="Startup Commands">
              <textarea
                className="field-input field-textarea"
                placeholder={"Commands to run on connect (one per line)\n\ncd /var/log\ntail -f syslog"}
                value={startupCommands}
                onChange={e => setStartupCommands(e.target.value)}
                rows={3}
              />
              {startupCommands.includes("{password}") && (
                <p className="field-help field-help--warn">
                  The password will be typed into the remote shell and may be
                  stored in its history or captured in session logs.
                </p>
              )}
            </Field>
          )}

          {connType === "ssh" && (
            <div className="field-row field-row--toggle">
              <label className="field-label">Legacy Crypto</label>
              <button
                type="button"
                className={clsx("toggle", allowLegacyCrypto && "toggle--on")}
                onClick={() => setAllowLegacyCrypto(!allowLegacyCrypto)}
                role="switch"
                aria-checked={allowLegacyCrypto}
              >
                <span className="toggle-thumb" />
              </button>
            </div>
          )}
          {connType === "ssh" && (
            <p className="field-help">
              Enable SHA-1 KEX, ssh-rsa keys, and CBC ciphers for legacy
              devices (Cisco switches, old routers).
            </p>
          )}

          <div className="field-row field-row--toggle">
            <label className="field-label">Auto Connect</label>
            <button
              type="button"
              className={clsx("toggle", autoConnect && "toggle--on")}
              onClick={() => setAutoConnect(!autoConnect)}
              role="switch"
              aria-checked={autoConnect}
            >
              <span className="toggle-thumb" />
            </button>
          </div>
          <p className="field-help">Automatically open this connection when SlimRDM launches.</p>

          {connType !== "rdp" && (
            <Field label="Log Sessions">
              <select
                className="field-input field-select"
                value={logSessions}
                onChange={e => setLogSessions(e.target.value as LogMode)}
              >
                <option value="inherit">Inherit (group / global default)</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </Field>
          )}

          {errors._form && <div className="form-error">{errors._form}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Connection"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, error, children, grow, width }: {
  label: string;
  error?: string;
  children: React.ReactNode;
  grow?: boolean;
  width?: number;
}) {
  return (
    <div className={clsx("field-row", grow && "field-row--grow")} style={width ? { width } : undefined}>
      <label className="field-label">{label}{error && <span className="field-error">{error}</span>}</label>
      {children}
    </div>
  );
}
