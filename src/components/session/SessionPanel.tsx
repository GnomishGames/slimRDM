import { useRef, useEffect } from "react";
import { Session } from "../../types";
import { useSshTerminal } from "../../hooks/useSshTerminal";
import { useRdpCanvas } from "../../hooks/useRdpCanvas";
import { useTrmTerminal } from "../../hooks/useTrmTerminal";
import clsx from "clsx";

interface Props {
  session: Session;
  /** Whether this panel is visible and should maintain a terminal connection. */
  active: boolean;
  /** Whether this panel has keyboard focus (fit + term.focus). */
  focused: boolean;
  /** Inline style for split-view absolute positioning. */
  style?: React.CSSProperties;
}

export function SessionPanel({ session, active, focused, style }: Props) {
  return (
    <div className={clsx("session-panel", active && "session-panel--active")} style={style}>
      {session.connection.connectionType === "ssh" ? (
        <SshPanel session={session} active={active} focused={focused} />
      ) : session.connection.connectionType === "trm" ? (
        <TrmPanel session={session} active={active} focused={focused} />
      ) : (
        <RdpPanel session={session} />
      )}
    </div>
  );
}

function SshPanel({ session, active, focused }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { connect, term, fit } = useSshTerminal({
    sessionId: session.id,
    connection: session.connection,
    containerRef,
  });

  useEffect(() => {
    if (!active) return;
    connect().catch(console.error);
  }, []);

  useEffect(() => {
    if (active) fit();
  }, [active]);

  useEffect(() => {
    if (focused) term.current?.focus();
  }, [focused]);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{ display: active ? "block" : "none" }}
    />
  );
}

function TrmPanel({ session, active, focused }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { connect, term, fit } = useTrmTerminal({
    sessionId: session.id,
    connection: session.connection,
    containerRef,
  });

  useEffect(() => {
    if (!active) return;
    connect().catch(console.error);
  }, []);

  useEffect(() => {
    if (active) fit();
  }, [active]);

  useEffect(() => {
    if (focused) term.current?.focus();
  }, [focused]);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{ display: active ? "block" : "none" }}
    />
  );
}

function RdpPanel({ session }: { session: Session }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { onMouseMove, onMouseDown, onMouseUp, onWheel, onKeyDown, onKeyUp } =
    useRdpCanvas({ sessionId: session.id, connection: session.connection, canvasRef });

  return (
    <div className="rdp-canvas-wrapper">
      {/* Canvas is always mounted so clientWidth/Height are available at connect time */}
      <canvas
        ref={canvasRef}
        className="rdp-canvas"
        tabIndex={0}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      {session.status === "connecting" && (
        <div className="rdp-overlay rdp-panel--loading">
          <div className="rdp-status-dot rdp-status-dot--connecting" />
          <span>Connecting to {session.connection.host}…</span>
        </div>
      )}
      {session.status === "error" && (
        <div className="rdp-overlay rdp-panel--error">
          <div className="rdp-status-dot rdp-status-dot--error" />
          <span>{session.error}</span>
        </div>
      )}
    </div>
  );
}
