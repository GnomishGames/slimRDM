import { X, Monitor, Terminal } from "lucide-react";
import { Columns2, Rows2 } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Session } from "../../types";
import { countLeaves } from "../../utils/paneTree";
import clsx from "clsx";

export function SessionTabs() {
  const { sessions, activeSessionId, tabLayouts, splitPane, setActiveSession, closeTab } = useAppStore();

  const activeTabId = activeSessionId
    ? (sessions.find((s) => s.id === activeSessionId)?.tabId ?? activeSessionId)
    : null;
  const primarySessions = sessions.filter((s) => s.tabId === s.id);
  const activeTabLayout = activeTabId ? tabLayouts[activeTabId] : undefined;
  const leafCount = activeTabLayout ? countLeaves(activeTabLayout) : 0;
  const canSplit = leafCount < 4 && activeSessionId !== null;

  return (
    <div className="tab-bar">
      <div className="tab-bar-tabs">
        {primarySessions.map((session) => (
          <Tab
            key={session.id}
            session={session}
            active={session.id === activeTabId}
            onActivate={() => setActiveSession(session.id)}
            onClose={() => closeTab(session.id)}
          />
        ))}
      </div>
      <div className="tab-bar-split-actions">
        <button
          className="tab-split-btn"
          title="Split right"
          disabled={!canSplit}
          onClick={() => activeSessionId && splitPane(activeSessionId, "vertical")}
        >
          <Columns2 size={13} />
        </button>
        <button
          className="tab-split-btn"
          title="Split down"
          disabled={!canSplit}
          onClick={() => activeSessionId && splitPane(activeSessionId, "horizontal")}
        >
          <Rows2 size={13} />
        </button>
      </div>
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
        {connType === "rdp"
          ? <Monitor size={12} />
          : connType === "trm"
          ? <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: -1 }}>$_</span>
          : <Terminal size={12} />}
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
