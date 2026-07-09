import { useEffect, useRef, useState, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/sidebar/Sidebar";
import { SessionTabs } from "./components/session/SessionTabs";
import { SessionPanel } from "./components/session/SessionPanel";
import { PaneHeader } from "./components/session/PaneHeader";
import { SplitDivider } from "./components/session/SplitDivider";
import { AddConnectionModal } from "./components/modals/AddConnectionModal";
import { useAppStore } from "./store/appStore";
import { useSettingsStore } from "./store/settingsStore";
import { useToastStore } from "./store/toastStore";
import { updates, UpdateInfo } from "./utils/tauri";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { collectLeafSessionIds, computePaneLayout, countLeaves } from "./utils/paneTree";
import "./styles.css";

export default function App() {
  const {
    loadConnections, loadGroups, loadCategories,
    sessions, activeSessionId, tabLayouts,
    splitPane, closePane, setActiveSession,
    updateTunnelRuntime, clearTunnelRuntime, loadTunnelConfigs,
    setSearchQuery,
  } = useAppStore();
  const loadSettings = useSettingsStore((s) => s.load);
  const toastMessage = useToastStore((s) => s.message);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeIdRef = useRef(activeSessionId);
  activeIdRef.current = activeSessionId;

  const contentRef = useRef<HTMLDivElement>(null);

  const activeTabId = activeSessionId
    ? (sessions.find((s) => s.id === activeSessionId)?.tabId ?? activeSessionId)
    : null;
  const activeTabLayout = activeTabId ? tabLayouts[activeTabId] : undefined;
  const isSplit = activeTabLayout !== undefined;

  const paneLayout = useMemo(
    () => (activeTabLayout ? computePaneLayout(activeTabLayout) : null),
    [activeTabLayout]
  );

  const leafCount = activeTabLayout ? countLeaves(activeTabLayout) : 0;

  useEffect(() => {
    const unlisten = listen<{ id: string; status: string; localPort?: number; error?: string }>(
      "tunnel-status",
      (event) => {
        const { id, status, localPort, error } = event.payload;
        if (status === "closed") {
          clearTunnelRuntime(id);
        } else if (status === "active") {
          updateTunnelRuntime(id, { status: "active", activeLocalPort: localPort, error: undefined });
        } else if (status === "error") {
          updateTunnelRuntime(id, { status: "error", error });
        } else {
          updateTunnelRuntime(id, { status: status as "connecting" });
        }
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    Promise.all([loadConnections(), loadGroups(), loadCategories(), loadSettings(), loadTunnelConfigs()])
      .then(() => {
        const { connections, openSession } = useAppStore.getState();
        connections
          .filter((c) => c.autoConnect)
          .forEach((c) => openSession(c));
      });
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

  // Tab/pane cycling:
  //   Ctrl+Tab / Ctrl+Shift+Tab → cycle primary sessions (tabs)
  //   Ctrl+PageDown / Ctrl+PageUp → cycle panes within the current tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;

      const sessions = sessionsRef.current;
      const activeTabId = sessions.find((s) => s.id === activeIdRef.current)?.tabId ?? activeIdRef.current;

      if (e.key === "Tab") {
        // Cycle between tabs (primary sessions).
        const primaries = sessions.filter((s) => s.tabId === s.id);
        if (primaries.length < 2) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = primaries.findIndex((s) => s.id === activeTabId);
        if (idx === -1) return;
        const next = e.shiftKey
          ? (idx - 1 + primaries.length) % primaries.length
          : (idx + 1) % primaries.length;
        setActiveSession(primaries[next].id);
      } else if (e.key === "PageDown" || e.key === "PageUp") {
        // Cycle between panes within the current tab.
        if (!activeTabId) return;
        const layout = useAppStore.getState().tabLayouts[activeTabId];
        if (!layout) return;
        const panes = collectLeafSessionIds(layout);
        if (panes.length < 2) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = panes.findIndex((id) => id === activeIdRef.current);
        if (idx === -1) return;
        const next = e.key === "PageDown"
          ? (idx + 1) % panes.length
          : (idx - 1 + panes.length) % panes.length;
        setActiveSession(panes[next]);
      }
    };
    // Capture phase: xterm's textarea calls stopPropagation() on keys it
    // handles (Tab, PageUp/PageDown), so a bubble-phase window listener never
    // sees them while a terminal is focused. Capturing at the window runs us
    // first, before the event reaches the terminal.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  return (
    <>
      {showAddModal && <AddConnectionModal onClose={() => setShowAddModal(false)} />}
      {toastMessage && <div className="copy-toast">{toastMessage}</div>}
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
                  await updates.install(updateInfo.downloadUrl, updateInfo.expectedSha256 ?? undefined);
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
                All session panels live in the same container at all times.
                Moving them to a different parent remounts xterm and kills connections.
                In split mode: absolute positioning places each panel in its pane slot.
                In single mode: display:none hides non-active panels (existing behaviour).
              */}
              <div ref={contentRef} className="session-content">
                {sessions.map((session) => {
                  const panelStyle = paneLayout?.panelStyles.get(session.id);
                  const active = isSplit
                    ? panelStyle !== undefined
                    : session.id === activeTabId;
                  const focused = session.id === activeSessionId;
                  return (
                    <SessionPanel
                      key={session.id}
                      session={session}
                      active={active}
                      focused={focused}
                      style={panelStyle}
                    />
                  );
                })}

                {isSplit && paneLayout && activeTabLayout && (
                  <>
                    {Array.from(paneLayout.headerStyles.entries()).map(([sessionId, style]) => {
                      const session = sessions.find((s) => s.id === sessionId);
                      if (!session) return null;
                      return (
                        <PaneHeader
                          key={`ph-${sessionId}`}
                          session={session}
                          style={style}
                          canSplit={leafCount < 4}
                          focused={sessionId === activeSessionId}
                          onFocus={() => setActiveSession(sessionId)}
                          onSplitV={() => splitPane(sessionId, "vertical")}
                          onSplitH={() => splitPane(sessionId, "horizontal")}
                          onClose={() => closePane(sessionId)}
                        />
                      );
                    })}
                    {paneLayout.dividers.map((d) => (
                      <SplitDivider
                        key={`div-${d.path.join("-") || "root"}`}
                        direction={d.direction}
                        path={d.path}
                        ratio={d.ratio}
                        nodeW={d.nodeW}
                        nodeH={d.nodeH}
                        style={d.style}
                        contentRef={contentRef}
                      />
                    ))}
                  </>
                )}
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
