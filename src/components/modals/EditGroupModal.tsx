import { useState, useEffect, useRef } from "react";
import { X, FolderOpen } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { credentials, dialog } from "../../utils/tauri";
import { AuthType, Group, LogMode } from "../../types";
import clsx from "clsx";


interface Props {
  group: Group;
  onClose: () => void;
}

export function EditGroupModal({ group, onClose }: Props) {
  const { updateGroup, categories } = useAppStore();
  const mouseDownOnBackdrop = useRef(false);
  const [name, setName] = useState(group.name);
  const [categoryId, setCategoryId] = useState(group.categoryId ?? "");
  const [username, setUsername] = useState(group.username ?? "");
  const [authType, setAuthType] = useState<AuthType>(group.authType ?? "password");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState(group.privateKeyPath ?? "");
  const [logSessions, setLogSessions] = useState<LogMode>(group.logSessions ?? "inherit");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const hasExistingCreds = !!(group.credentialRef || group.privateKeyPath);

  useEffect(() => {
    if (group.credentialRef) {
      credentials.get(group.credentialRef).then(setPassword).catch(() => {});
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Required";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      let credentialRef = group.credentialRef;
      let keyPath: string | undefined = undefined;

      if (username.trim()) {
        if (authType === "password") {
          credentialRef = `group:${group.id}`;
          if (password) await credentials.save(credentialRef, password);
          keyPath = undefined;
          // Clear any old key path
        } else if (authType === "public_key") {
          // Clear password credential if switching from password
          if (group.credentialRef) await credentials.delete(group.credentialRef).catch(() => {});
          credentialRef = undefined;
          keyPath = privateKeyPath.trim() || undefined;
        }
      } else {
        // No username — clear everything
        if (group.credentialRef) await credentials.delete(group.credentialRef).catch(() => {});
        credentialRef = undefined;
        keyPath = undefined;
      }

      await updateGroup({
        ...group,
        name: name.trim(),
        categoryId: categoryId || undefined,
        username: username.trim() || undefined,
        credentialRef,
        authType: username.trim() ? authType : undefined,
        privateKeyPath: keyPath,
        logSessions,
      });
      onClose();
    } catch (err) {
      setErrors({ _form: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleClearCredentials = async () => {
    if (group.credentialRef) await credentials.delete(group.credentialRef).catch(() => {});
    setUsername("");
    setPassword("");
    setPrivateKeyPath("");
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={() => { if (mouseDownOnBackdrop.current) onClose(); }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Edit Group</span>
          <button className="icon-btn" onClick={onClose}><X size={15} /></button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <Field label="Name" error={errors.name}>
            <input
              className={clsx("field-input", errors.name && "field-input--error")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>

          {categories.length > 0 && (
            <Field label="Category">
              <select className="field-input field-select" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          )}

          <div className="field-section-divider">Group Credentials</div>

          <Field label="Username">
            <input
              className="field-input"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>

          {username.trim() && (
            <div className="field-row">
              <label className="field-label">Auth</label>
              <div className="auth-tabs">
                {(["password", "public_key"] as AuthType[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={clsx("auth-tab", authType === a && "auth-tab--active")}
                    onClick={() => setAuthType(a)}
                  >
                    {a === "public_key" ? "Key" : "Password"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {username.trim() && authType === "password" && (
            <Field label={"Password"}>
              <input
                className="field-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}

          {username.trim() && authType === "public_key" && (
            <Field label="Key path" error={errors.privateKeyPath}>
              <div className="field-browse">
                <input
                  className={clsx("field-input", errors.privateKeyPath && "field-input--error")}
                  placeholder="~/.ssh/id_rsa"
                  value={privateKeyPath}
                  onChange={(e) => setPrivateKeyPath(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  onClick={async () => {
                    const picked = await dialog.pickFile("Select SSH private key");
                    if (picked) setPrivateKeyPath(picked as string);
                  }}
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </Field>
          )}

          {hasExistingCreds && (
            <div className="field-row">
              <label className="field-label" />
              <button type="button" className="btn btn--ghost btn--sm" onClick={handleClearCredentials}>
                Clear credentials
              </button>
            </div>
          )}

          <div className="field-section-divider">Session Logging</div>

          <Field label="Log Sessions">
            <select
              className="field-input field-select"
              value={logSessions}
              onChange={e => setLogSessions(e.target.value as LogMode)}
            >
              <option value="inherit">Inherit (global default)</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </Field>

          {errors._form && <div className="form-error">{errors._form}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, error, children }: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field-row">
      <label className="field-label">{label}{error && <span className="field-error">{error}</span>}</label>
      {children}
    </div>
  );
}
