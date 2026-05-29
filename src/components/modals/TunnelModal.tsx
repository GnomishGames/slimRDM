import { useState, useRef } from "react";
import { X } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { TunnelConfig } from "../../types";

interface Props {
  editing?: TunnelConfig;
  onClose: () => void;
}

export function TunnelModal({ editing, onClose }: Props) {
  const { connections, addTunnelConfig, editTunnelConfig } = useAppStore();
  const mouseDownOnBackdrop = useRef(false);

  const sshConnections = connections.filter((c) => c.connectionType === "ssh");

  const [name, setName] = useState(editing?.name ?? "");
  const [jumpHostId, setJumpHostId] = useState(editing?.jumpHostId ?? sshConnections[0]?.id ?? "");
  const [remoteHost, setRemoteHost] = useState(editing?.remoteHost ?? "");
  const [remotePort, setRemotePort] = useState(String(editing?.remotePort ?? 22));
  const [localPort, setLocalPort] = useState(editing?.localPort ? String(editing.localPort) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!jumpHostId) errs.jumpHostId = "Required";
    if (!remoteHost.trim()) errs.remoteHost = "Required";
    const port = parseInt(remotePort, 10);
    if (!port || port < 1 || port > 65535) errs.remotePort = "1–65535";
    const lport = localPort.trim() ? parseInt(localPort, 10) : 0;
    if (localPort.trim() && (isNaN(lport) || lport < 1 || lport > 65535)) errs.localPort = "1–65535";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      if (editing) {
        await editTunnelConfig({
          id: editing.id,
          name: name.trim() || `${remoteHost.trim()}:${port}`,
          jumpHostId,
          remoteHost: remoteHost.trim(),
          remotePort: port,
          localPort: lport,
        });
      } else {
        await addTunnelConfig({
          name: name.trim(),
          jumpHostId,
          remoteHost: remoteHost.trim(),
          remotePort: port,
          localPort: lport,
        });
      }
      onClose();
    } catch (err) {
      setErrors({ submit: String(err) });
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => { if (mouseDownOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{editing ? "Edit Tunnel" : "New SSH Tunnel"}</span>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field-row">
              <label className="field-label">Name <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span></label>
              <input
                className="field-input"
                placeholder="e.g. DB tunnel"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="field-row">
              <label className="field-label">
                Jump host (SSH connection)
                {errors.jumpHostId && <span className="field-error"> — {errors.jumpHostId}</span>}
              </label>
              {sshConnections.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No SSH connections — add one first.</p>
              ) : (
                <select
                  className="field-input field-select"
                  value={jumpHostId}
                  onChange={(e) => setJumpHostId(e.target.value)}
                >
                  {sshConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.username}@{c.host}:{c.port})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="field-row-group">
              <div className="field-row field-row--grow">
                <label className="field-label">
                  Remote host
                  {errors.remoteHost && <span className="field-error"> — {errors.remoteHost}</span>}
                </label>
                <input
                  className={`field-input${errors.remoteHost ? " field-input--error" : ""}`}
                  placeholder="192.168.1.10"
                  value={remoteHost}
                  onChange={(e) => setRemoteHost(e.target.value)}
                />
              </div>
              <div className="field-row" style={{ width: 80, flexShrink: 0 }}>
                <label className="field-label">
                  Port{errors.remotePort && <span className="field-error"> !</span>}
                </label>
                <input
                  className={`field-input${errors.remotePort ? " field-input--error" : ""}`}
                  type="number"
                  min={1}
                  max={65535}
                  value={remotePort}
                  onChange={(e) => setRemotePort(e.target.value)}
                />
              </div>
            </div>

            <div className="field-row" style={{ width: 120 }}>
              <label className="field-label">
                Local port{errors.localPort && <span className="field-error"> — {errors.localPort}</span>}
              </label>
              <input
                className={`field-input${errors.localPort ? " field-input--error" : ""}`}
                type="number"
                min={1}
                max={65535}
                placeholder="auto"
                value={localPort}
                onChange={(e) => setLocalPort(e.target.value)}
              />
            </div>

            {errors.submit && (
              <p style={{ fontSize: 11, color: "var(--red)" }}>{errors.submit}</p>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || sshConnections.length === 0}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Save Tunnel"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
