import { useState, useEffect, useRef } from "react";
import { X, Bug, Lightbulb, AlertTriangle, HelpCircle, ExternalLink } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import clsx from "clsx";

interface Props {
  onClose: () => void;
}

type IssueType = "bug" | "feature" | "crash" | "other";

const ISSUE_TYPES: { value: IssueType; label: string; icon: React.ReactNode }[] = [
  { value: "bug", label: "Bug Report", icon: <Bug size={14} /> },
  { value: "feature", label: "Feature Request", icon: <Lightbulb size={14} /> },
  { value: "crash", label: "Crash Report", icon: <AlertTriangle size={14} /> },
  { value: "other", label: "Other", icon: <HelpCircle size={14} /> },
];

const LABEL_MAP: Record<IssueType, string> = {
  bug: "bug",
  feature: "enhancement",
  crash: "crash",
  other: "",
};

const BODY_TEMPLATE = `## Description
<!-- What went wrong? Be specific. -->



## Steps to Reproduce
<!-- If applicable, list the exact steps: -->
1. 
2. 
3. 



## Expected Behavior
<!-- What did you expect to happen? -->



## Actual Behavior
<!-- What actually happened? -->



**App Version:** %VERSION%
**OS:** %OS%`;

function getOS() {
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Macintosh")) return "macOS";
  if (ua.includes("Linux")) return "Linux";
  return "Unknown";
}

export function ReportIssueModal({ onClose }: Props) {
  const mouseDownOnBackdrop = useRef(false);

  const [title, setTitle] = useState("");
  const [issueType, setIssueType] = useState<IssueType>("bug");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Title is required";
    if (!description.trim()) e.description = "Description is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const os = getOS();
    const body = BODY_TEMPLATE
      .replace("%VERSION%", version)
      .replace("%OS%", os)
      .replace("## Description\n<!-- What went wrong? Be specific. -->\n\n\n", `## Description\n${description}\n\n`);

    const params = new URLSearchParams({
      title: title.trim(),
      body,
    });

    const label = LABEL_MAP[issueType];
    if (label) {
      params.set("labels", label);
    }

    const url = `https://github.com/GnomishGames/slimRDM/issues/new?${params.toString()}`;
    openUrl(url);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={() => { if (mouseDownOnBackdrop.current) onClose(); }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Report an Issue</span>
          <button className="icon-btn" onClick={onClose}><X size={15} /></button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="field-row">
            <label className="field-label">
              Issue Type
            </label>
            <div className="issue-type-grid">
              {ISSUE_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  className={clsx("issue-type-btn", issueType === type.value && "issue-type-btn--active")}
                  onClick={() => setIssueType(type.value)}
                >
                  {type.icon}
                  <span>{type.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <label className="field-label">
              Title <span className="field-required">*</span>
            </label>
            <input
              type="text"
              className={clsx("field-input", errors.title && "field-input--error")}
              placeholder="Brief description of the issue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            {errors.title && <span className="field-error">{errors.title}</span>}
          </div>

          <div className="field-row">
            <label className="field-label">
              Description <span className="field-required">*</span>
            </label>
            <textarea
              className={clsx("field-input", "field-textarea", errors.description && "field-input--error")}
              placeholder="Please describe the issue in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
            />
            {errors.description && <span className="field-error">{errors.description}</span>}
          </div>

          <div className="field-row">
            <label className="field-label">App Version</label>
            <input
              type="text"
              className="field-input"
              value={version}
              readOnly
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary">
              <ExternalLink size={13} />
              Open in GitHub
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}