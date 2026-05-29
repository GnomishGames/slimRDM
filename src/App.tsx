import { useEffect, useRef, useState, useCallback } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { SessionTabs } from "./components/session/SessionTabs";
import { SessionPanel } from "./components/session/SessionPanel";
import { AddConnectionModal } from "./components/modals/AddConnectionModal";
import { useAppStore } from "./store/appStore";
import { useSettingsStore } from "./store/settingsStore";
import { updates, UpdateInfo } from "./utils/tauri";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import "./styles.css";

const DIVIDER_PX = 4;
const MIN_PANE_PCT = 10;

function equalSizes(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => i < n - 1 ? base : 100 - base * (n - 1));
}

export default function App() {
  const {
    loadConnections, loadGroups, loadCategories,
    sessions, activeSessionId, splitSessionIds, setSplitSessions,
    setSearchQuery, setActiveSession,
  } = useAppStore();
  const loadSettings = useSettingsStore((s) => s.load);
  const splitView = useSettingsStore((s) => s.behavior.splitView);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeIdRef = useRef(activeSessionId);
  activeIdRef.current = activeSessionId;

  // Split view sizing state
  const [splitSizes, setSplitSizes] = useState<number[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);

  // Initialise split panes when split view is first enabled
  useEffect(() => {
    if (splitView && splitSessionIds.length === 0 && activeSessionId) {
      setSplitSessions([activeSessionId]);
    }
  }, [splitView]);

  // Reset to equal sizes whenever the pane count changes
  const prevSplitCount = useRef(0);
  useEffect(() => {
    const n = splitSessionIds.length;
    if (n === prevSplitCount.current) return;
    prevSplitCount.current = n;
    setSplitSizes(equalSizes(n));
  }, [splitSessionIds.length]);

  // Keyboard tab cycling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || sessionsRef.current.length < 2) return;
      if (e.key !== "PageDown" && e.key !== "PageUp") return;
      e.preventDefault();
      const idx = sessionsRef.current.findIndex((s) => s.id === activeIdRef.current);
      if (idx === -1) return;
      const next = e.key === "PageDown"
        ? (idx + 1) % sessionsRef.current.length
        : (idx - 1 + sessionsRef.current.length) % sessionsRef.current.length;
      setActiveSession(sessionsRef.current[next].id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    loadConnections();
    loadGroups();
    loadCategories();
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
      if (target.isContentEditable || target.closest(".terminal-container")) return;
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

  // Drag-to-resize split panes
  const handleDividerMouseDown = useCallback((dividerIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startSizes = [...splitSizes];
    const containerWidth = contentRef.current?.offsetWidth ?? 0;
    const numDividers = startSizes.length - 1;
    const availWidth = containerWidth - numDividers * DIVIDER_PX;
    if (availWidth <= 0) return;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dpct = (dx / availWidth) * 100;
      const left = startSizes[dividerIdx] + dpct;
      const right = startSizes[dividerIdx + 1] - dpct;
      if (left < MIN_PANE_PCT || right < MIN_PANE_PCT) return;
      const next = [...startSizes];
      next[dividerIdx] = left;
      next[dividerIdx + 1] = right;
      setSplitSizes(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [splitSizes]);

  // Calculate absolute position style for a split pane
  function getPaneStyle(splitIdx: number): React.CSSProperties {
    if (!splitView || splitSizes.length <= splitIdx || splitSizes.length === 0) return {};
    const numDividers = splitSizes.length - 1;
    const prevPct = splitSizes.slice(0, splitIdx).reduce((a, b) => a + b, 0);
    const leftPx = splitIdx * DIVIDER_PX - (prevPct / 100) * numDividers * DIVIDER_PX;
    const widthPx = -(splitSizes[splitIdx] / 100) * numDividers * DIVIDER_PX;
    return {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: leftPx === 0 ? `${prevPct}%` : `calc(${prevPct}% + ${leftPx}px)`,
      width: widthPx === 0 ? `${splitSizes[splitIdx]}%` : `calc(${splitSizes[splitIdx]}% + ${widthPx}px)`,
    };
  }

  // Calculate position for a drag-handle divider (placed after pane dividerIdx)
  function getDividerStyle(dividerIdx: number): React.CSSProperties {
    const numDividers = splitSizes.length - 1;
    const prevPct = splitSizes.slice(0, dividerIdx + 1).reduce((a, b) => a + b, 0);
    const leftPx = dividerIdx * DIVIDER_PX - (prevPct / 100) * numDividers * DIVIDER_PX;
    return {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: leftPx === 0 ? `${prevPct}%` : `calc(${prevPct}% + ${leftPx}px)`,
      width: DIVIDER_PX,
    };
  }

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
              {/*
                All session panels live in the same container at all times — moving them
                to a different parent would remount xterm and kill the connection.
                In split mode we use absolute positioning to lay them out side by side.
              */}
              <div ref={contentRef} className="session-content">
                {sessions.map((session) => {
                  const splitIdx = splitView ? splitSessionIds.indexOf(session.id) : -1;
                  const active = splitView ? splitIdx >= 0 : session.id === activeSessionId;
                  const focused = session.id === activeSessionId;
                  const style = splitView && splitIdx >= 0 ? getPaneStyle(splitIdx) : undefined;
                  return (
                    <SessionPanel
                      key={session.id}
                      session={session}
                      active={active}
                      focused={focused}
                      style={style}
                    />
                  );
                })}
                {/* Drag-handle dividers between split panes */}
                {splitView && splitSizes.length > 1 &&
                  Array.from({ length: splitSizes.length - 1 }, (_, i) => (
                    <div
                      key={`divider-${i}`}
                      className="split-divider"
                      style={getDividerStyle(i)}
                      onMouseDown={(e) => handleDividerMouseDown(i, e)}
                    />
                  ))
                }
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
