import { useEffect } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { SessionTabs } from "./components/session/SessionTabs";
import { SessionPanel } from "./components/session/SessionPanel";
import { useAppStore } from "./store/appStore";
import { useSettingsStore } from "./store/settingsStore";
import "./styles.css";

export default function App() {
  const { loadConnections, loadGroups, sessions, activeSessionId } = useAppStore();
  const loadSettings = useSettingsStore((s) => s.load);

  useEffect(() => {
    loadConnections();
    loadGroups();
    loadSettings();
  }, []);

  return (
    <div className="app-root">
      <Sidebar />
      <div className="main-area">
        {sessions.length > 0 ? (
          <>
            <SessionTabs />
            <div className="session-content">
              {sessions.map((session) => (
                <SessionPanel
                  key={session.id}
                  session={session}
                  active={session.id === activeSessionId}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <div className="empty-logo">
          <span className="logo-bracket">[</span>
          <span className="logo-text">SlimRDM</span>
          <span className="logo-bracket">]</span>
        </div>
        <p className="empty-hint">Select a connection from the sidebar to get started</p>
        <div className="empty-shortcuts">
          <span className="shortcut"><kbd>N</kbd> New connection</span>
          <span className="shortcut"><kbd>/</kbd> Search</span>
        </div>
      </div>
    </div>
  );
}
