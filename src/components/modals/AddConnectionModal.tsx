import { useState } from "react";
import { X, Monitor, Terminal } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { credentials } from "../../utils/tauri";
import { ConnectionType, AuthType } from "../../types";
import clsx from "clsx";

interface Props {
  onClose: () => void;
}

const DEFAULTS: Record<ConnectionType, { port: number; authType: AuthType }> = {
  ssh: { port: 22, authType: "password" },
  rdp: { port: 3389, authType: "password" },
};

export function AddConnectionModal({ onClose }: Props) {
  const { addConnection } = useAppStore();

  const [connType, setConnType] = useState<ConnectionType>("ssh");
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(DEFAULTS.ssh.port);
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<AuthType>("password");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const switchType = (t: ConnectionType) => {
    setConnType(t);
    setPort(DEFAULTS[t].port);
    setAuthType(DEFAULTS[t].authType);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!label.trim()) e.label = "Required";
    if (!host.trim()) e.host = "Required";
    if (!port || port < 1 || port > 65535) e.port = "1–65535";
    if (!username.trim()) e.username = "Required";
    if (authType === "password" && !password) e.password = "Required";
    if (authType === "public_key" && !privateKeyPath.trim()) e.privateKeyPath = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      let credentialRef: string | undefined;
      if (authType === "password" && password) {
        credentialRef = `${host}:${port}:${username}`;
        await credentials.save(credentialRef, password);
      }
      await addConnection({
        label: label.trim(),
        host: host.trim(),
        port,
        username: username.trim(),
        connectionType: connType,
        authType,
        privateKeyPath: authType === "public_key" ? privateKeyPath.trim() : undefined,
        credentialRef,
        notes: notes.trim() || undefined,
        tags: [],
      });
      onClose();
    } catch (err) {
      setErrors({ _form: String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">New Connection</span>
          <button className="icon-btn" onClick={onClose}><X size={15} /></button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          {/* Type toggle */}
          <div className="field-row">
            <label className="field-label">Type</label>
            <div className="type-toggle">
              <button type="button" className={clsx("type-btn", connType === "ssh" && "type-btn--active")} onClick={() => switchType("ssh")}>
                <Terminal size={13} /> SSH
              </button>
              <button type="button" className={clsx("type-btn", connType === "rdp" && "type-btn--active")} onClick={() => switchType("rdp")}>
                <Monitor size={13} /> RDP
              </button>
            </div>
          </div>

          <Field label="Label" error={errors.label}>
            <input className={clsx("field-input", errors.label && "field-input--error")} placeholder="My Server" value={label} onChange={e => setLabel(e.target.value)} autoFocus />
          </Field>

          <div className="field-row-group">
            <Field label="Host" error={errors.host} grow>
              <input className={clsx("field-input", errors.host && "field-input--error")} placeholder="192.168.1.1" value={host} onChange={e => setHost(e.target.value)} />
            </Field>
            <Field label="Port" error={errors.port} width={80}>
              <input className={clsx("field-input", errors.port && "field-input--error")} type="number" value={port} onChange={e => setPort(Number(e.target.value))} />
            </Field>
          </div>

          <Field label="Username" error={errors.username}>
            <input className={clsx("field-input", errors.username && "field-input--error")} placeholder="admin" value={username} onChange={e => setUsername(e.target.value)} />
          </Field>

          {connType === "ssh" && (
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

          {authType === "password" && (
            <Field label="Password" error={errors.password}>
              <input className={clsx("field-input", errors.password && "field-input--error")} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
            </Field>
          )}

          {authType === "public_key" && (
            <Field label="Key path" error={errors.privateKeyPath}>
              <input className={clsx("field-input", errors.privateKeyPath && "field-input--error")} placeholder="~/.ssh/id_rsa" value={privateKeyPath} onChange={e => setPrivateKeyPath(e.target.value)} />
            </Field>
          )}

          <Field label="Notes">
            <textarea className="field-input field-textarea" placeholder="Optional notes..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </Field>

          {errors._form && <div className="form-error">{errors._form}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Add Connection"}
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
