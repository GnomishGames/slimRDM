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
  const [localPort, setLocalPort] = useState(editing?.localPort ? String(editing.localPort) : "");
  const [remoteHost, setRemoteHost] = useState(editing?.remoteHost ?? "");
  const [remotePort, setRemotePort] = useState(String(editing?.remotePort ?? 80));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!jumpHostId) errs.jumpHostId = "Required";
    if (!remoteHost.trim()) errs.remoteHost = "Required";
    const rport = parseInt(remotePort, 10);
    if (!rport || rport < 1 || rport > 65535) errs.remotePort = "1–65535";
    const lport = localPort.trim() ? parseInt(localPort, 10) : 0;
    if (localPort.trim() && (isNaN(lport) || lport < 1 || lport > 65535)) errs.localPort = "1–65535";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const displayName = name.trim() || `${remoteHost.trim()}:${rport}`;
    setSaving(true);
    try {
      if (editing) {
        await editTunnelConfig({
          id: editing.id,
          name: displayName,
          jumpHostId,
          remoteHost: remoteHost.trim(),
          remotePort: rport,
          localPort: lport,
        });
      } else {
        await addTunnelConfig({
          name: displayName,
          jumpHostId,
          remoteHost: remoteHost.trim(),
          remotePort: rport,
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
                placeholder="e.g. Web tunnel"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Step 1: which server to SSH into */}
            <div className="field-row">
              <label className="field-label">
                SSH connection
                {errors.jumpHostId && <span className="field-error"> — {errors.jumpHostId}</span>}
              </label>
              <p className="field-hint">The remote server traffic tunnels through (port 22)</p>
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

            {/* Step 2: local port on the user's machine */}
            <div className="field-row">
              <label className="field-label">
                Local port (source)
                {errors.localPort && <span className="field-error"> — {errors.localPort}</span>}
              </label>
              <p className="field-hint">Port on your machine — what you connect to locally</p>
              <div className="tunnel-localhost-row">
                <span className="tunnel-localhost-prefix">localhost:</span>
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
            </div>

            {/* Step 3: where traffic goes on the remote side */}
            <div className="field-row">
              <label className="field-label">
                Forward to (destination)
                {errors.remoteHost && <span className="field-error"> — {errors.remoteHost}</span>}
                {errors.remotePort && <span className="field-error"> — port {errors.remotePort}</span>}
              </label>
              <p className="field-hint">Host reachable from the SSH server — use localhost for services on it</p>
              <div className="field-row-group">
                <input
                  className={`field-input${errors.remoteHost ? " field-input--error" : ""}`}
                  placeholder="localhost or host/IP"
                  value={remoteHost}
                  onChange={(e) => setRemoteHost(e.target.value)}
                />
                <input
                  className={`field-input${errors.remotePort ? " field-input--error" : ""}`}
                  type="number"
                  min={1}
                  max={65535}
                  placeholder="Port"
                  value={remotePort}
                  style={{ width: 80, flexShrink: 0 }}
                  onChange={(e) => setRemotePort(e.target.value)}
                />
              </div>
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
