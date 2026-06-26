import type { CSSProperties } from "react";
import { useCallback } from "react";
import { X, Columns2, Rows2 } from "lucide-react";
import clsx from "clsx";
import type { Session } from "../../types";
import { useSettingsStore } from "../../store/settingsStore";

interface Props {
  session: Session;
  style: CSSProperties;
  canSplit: boolean;
  focused: boolean;
  onSplitV: () => void;
  onSplitH: () => void;
  onClose: () => void;
  onFocus: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  connecting: "#d29922",
  connected: "#3fb950",
  disconnected: "#6e7681",
  error: "#ff7b72",
};

export function PaneHeader({
  session,
  style,
  canSplit,
  focused,
  onSplitV,
  onSplitH,
  onClose,
  onFocus,
}: Props) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Don't steal focus from buttons
      if ((e.target as HTMLElement).closest("button")) return;
      onFocus();
    },
    [onFocus]
  );

  return (
    <div
      className={clsx("pane-header", focused && "pane-header--focused")}
      style={style}
      onMouseDown={handleMouseDown}
    >
      <span
        className="pane-header-dot"
        style={{ background: STATUS_COLOR[session.status] ?? "#6e7681" }}
      />
      <span className="pane-header-label">{session.connection.label}</span>
      <div className="pane-header-actions">
        <button
          className="pane-header-btn"
          title="Split right"
          disabled={!canSplit}
          onClick={(e) => { e.stopPropagation(); onSplitV(); }}
        >
          <Columns2 size={12} />
        </button>
        <button
          className="pane-header-btn"
          title="Split down"
          disabled={!canSplit}
          onClick={(e) => { e.stopPropagation(); onSplitH(); }}
        >
          <Rows2 size={12} />
        </button>
        <button
          className="pane-header-btn pane-header-btn--close"
          title="Close pane"
          onClick={(e) => {
            e.stopPropagation();
            const { behavior } = useSettingsStore.getState();
            if (behavior.confirmCloseTab && !window.confirm(`Close "${session.connection.label}"?`)) return;
            onClose();
          }}
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
}
