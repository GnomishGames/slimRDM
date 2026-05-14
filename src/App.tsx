import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { SessionTabs } from "./components/session/SessionTabs";
import { SessionPanel } from "./components/session/SessionPanel";
import { AddConnectionModal } from "./components/modals/AddConnectionModal";
import { useAppStore } from "./store/appStore";
import { useSettingsStore } from "./store/settingsStore";
import { updates, UpdateInfo } from "./utils/tauri";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import "./styles.css";

export default function App() {
  const { loadConnections, loadGroups, sessions, activeSessionId, setSearchQuery } = useAppStore();
  const loadSettings = useSettingsStore((s) => s.load);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    loadConnections();
    loadGroups();
    loadSettings();
    updates.check().then((info) => {
      if (info.hasUpdate) {
        setUpdateInfo(info);
        dismissTimerRef.current = setTimeout(() => setUpdateInfo(null), 5000);
      }
    }).catch(() => {});

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "CANVAS") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        setSearchQuery("");
        setTimeout(() => {
          document.querySelector<HTMLInputElement>(".search-input")?.focus();
        }, 0);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setShowAddModal(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      {showAddModal && <AddConnectionModal onClose={() => setShowAddModal(false)} />}
      {updateInfo && (
        <div className="update-toast">
          <span>v{updateInfo.latestVersion} available</span>
          {updateDownloading ? (
            <span className="update-toast-status">Downloading…</span>
          ) : (
            <button
              onClick={async () => {
                if (!updateInfo.downloadUrl) {
                  openUrl("https://github.com/GnomishGames/slimRDM/releases");
                  return;
                }
                if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
                setUpdateDownloading(true);
                try {
                  await updates.install(updateInfo.downloadUrl);
                } catch { /* installer launched or failed; dismiss either way */ }
                setUpdateInfo(null);
                setUpdateDownloading(false);
              }}
            >
              {updateInfo.downloadUrl ? "Install" : "View Release"}
            </button>
          )}
        </div>
      )}
      <div className="app-root">
        <Sidebar onOpenAddModal={() => setShowAddModal(true)} />
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
    </>
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
