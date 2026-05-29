import { useEffect, useRef, useState, useMemo, useCallback } from "react";
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

/** Offset in % and px for a pane or divider along the split axis. */
function axisOffset(
  idx: number,
  sizes: number[],
  numDividers: number,
): { pct: number; px: number } {
  const pct = sizes.slice(0, idx).reduce((a, b) => a + b, 0);
  const px = idx * DIVIDER_PX - (pct / 100) * numDividers * DIVIDER_PX;
  return { pct, px };
}

function calcStr(pct: number, px: number): string {
  if (px === 0) return `${pct}%`;
  return `calc(${pct}% + ${px}px)`;
}

export default function App() {
  const {
    loadConnections, loadGroups, loadCategories,
    sessions, activeSessionId, splitSessionIds, setSplitSessions,
    setSearchQuery, setActiveSession,
  } = useAppStore();
  const loadSettings = useSettingsStore((s) => s.load);
  const splitView = useSettingsStore((s) => s.behavior.splitView);
  const splitViewDirection = useSettingsStore((s) => s.behavior.splitViewDirection);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeIdRef = useRef(activeSessionId);
  activeIdRef.current = activeSessionId;

  // User-dragged sizes (percentages, sum=100). Length may lag splitSessionIds.length
  // by one render cycle — use effectiveSizes below instead.
  const [splitSizes, setSplitSizes] = useState<number[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);

  // Always length-matched to splitSessionIds. Falls back to equal sizes if the
  // dragged sizes array doesn't match yet (happens on the transitional render
  // after a pane is added/removed before the resetting effect fires).
  const effectiveSizes = useMemo(() => {
    const n = splitSessionIds.length;
    if (splitSizes.length === n) return splitSizes;
    return equalSizes(n);
  }, [splitSizes, splitSessionIds.length]);

  // Reset to equal sizes when the number of panes changes.
  useEffect(() => {
    setSplitSizes(equalSizes(splitSessionIds.length));
  }, [splitSessionIds.length]);

  // Reset to equal sizes when direction changes (axes swap, old sizes are meaningless).
  useEffect(() => {
    setSplitSizes(equalSizes(splitSessionIds.length));
  }, [splitViewDirection]);

  // Seed the first split pane when split view is enabled with no panes yet.
  useEffect(() => {
    if (splitView && splitSessionIds.length === 0 && activeSessionId) {
      setSplitSessions([activeSessionId]);
    }
  }, [splitView]);

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
    Promise.all([loadConnections(), loadGroups(), loadCategories(), loadSettings()])
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

  // Drag-to-resize split panes — works for both directions.
  const handleDividerMouseDown = useCallback((dividerIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    const isHoriz = splitViewDirection === "horizontal";
    const startPos = isHoriz ? e.clientY : e.clientX;
    const startSizes = [...effectiveSizes];
    const containerSize = isHoriz
      ? (contentRef.current?.offsetHeight ?? 0)
      : (contentRef.current?.offsetWidth ?? 0);
    const numDividers = startSizes.length - 1;
    const availSize = containerSize - numDividers * DIVIDER_PX;
    if (availSize <= 0) return;

    const onMove = (ev: MouseEvent) => {
      const delta = (isHoriz ? ev.clientY : ev.clientX) - startPos;
      const dpct = (delta / availSize) * 100;
      const a = startSizes[dividerIdx] + dpct;
      const b = startSizes[dividerIdx + 1] - dpct;
      if (a < MIN_PANE_PCT || b < MIN_PANE_PCT) return;
      const next = [...startSizes];
      next[dividerIdx] = a;
      next[dividerIdx + 1] = b;
      setSplitSizes(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [effectiveSizes, splitViewDirection]);

  // Inline style for a split pane at the given index.
  function getPaneStyle(splitIdx: number): React.CSSProperties {
    if (!splitView || effectiveSizes.length === 0) return {};
    const n = effectiveSizes.length;
    const numDividers = n - 1;
    const size = effectiveSizes[splitIdx];
    const { pct: posPct, px: posPx } = axisOffset(splitIdx, effectiveSizes, numDividers);
    const sizePx = -(size / 100) * numDividers * DIVIDER_PX;

    if (splitViewDirection === "horizontal") {
      return {
        position: "absolute",
        left: 0,
        right: 0,
        top: calcStr(posPct, posPx),
        height: calcStr(size, sizePx),
      };
    }
    return {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: calcStr(posPct, posPx),
      width: calcStr(size, sizePx),
    };
  }

  // Inline style for the drag-handle divider placed after pane dividerIdx.
  function getDividerStyle(dividerIdx: number): React.CSSProperties {
    const numDividers = effectiveSizes.length - 1;
    // The divider sits between pane dividerIdx and dividerIdx+1, at the right/bottom
    // edge of pane dividerIdx. That edge = axisOffset of pane (dividerIdx+1) - DIVIDER_PX,
    // which simplifies to axisOffset(dividerIdx+1) with i*DIVIDER_PX → (dividerIdx)*DIVIDER_PX.
    const { pct, px } = axisOffset(dividerIdx + 1, effectiveSizes, numDividers);
    const edgePx = px - DIVIDER_PX; // shift back by divider width to land on the gap

    if (splitViewDirection === "horizontal") {
      return {
        position: "absolute",
        left: 0,
        right: 0,
        top: calcStr(pct, edgePx),
        height: DIVIDER_PX,
      };
    }
    return {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: calcStr(pct, edgePx),
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
                to a different parent would remount xterm and kill connections.
                In split mode we use absolute positioning to lay them out side by side
                (vertical) or top-to-bottom (horizontal).
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
                {splitView && effectiveSizes.length > 1 &&
                  Array.from({ length: effectiveSizes.length - 1 }, (_, i) => (
                    <div
                      key={`divider-${i}`}
                      className={`split-divider split-divider--${splitViewDirection}`}
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
