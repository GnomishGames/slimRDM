import { X, Monitor, Terminal } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Session } from "../../types";
import clsx from "clsx";

export function SessionTabs() {
  const { sessions, activeSessionId, setActiveSession, closeSession } = useAppStore();

  return (
    <div className="tab-bar">
      {sessions.map((session) => (
        <Tab
          key={session.id}
          session={session}
          active={session.id === activeSessionId}
          onActivate={() => setActiveSession(session.id)}
          onClose={() => closeSession(session.id)}
        />
      ))}
    </div>
  );
}

function Tab({
  session, active, onActivate, onClose,
}: {
  session: Session;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const connType = session.connection.connectionType;
  const statusColor = {
    connecting: "#d29922",
    connected: "#3fb950",
    disconnected: "#6e7681",
    error: "#ff7b72",
  }[session.status];

  return (
    <button
      className={clsx("tab", active && "tab--active")}
      onClick={onActivate}
    >
      <span className="tab-icon">
        {connType === "rdp" ? <Monitor size={12} /> : connType === "trm" ? <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: -1 }}>$_</span> : <Terminal size={12} />}
      </span>
      <span className="tab-dot" style={{ background: statusColor }} />
      <span className="tab-label">{session.connection.label}</span>
      <button
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation();
          const { behavior } = useSettingsStore.getState();
          if (behavior.confirmCloseTab && !window.confirm(`Close "${session.connection.label}"?`)) return;
          onClose();
        }}
      >
        <X size={11} />
      </button>
    </button>
  );
}
