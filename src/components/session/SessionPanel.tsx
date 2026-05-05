import { useRef, useEffect } from "react";
import { Session } from "../../types";
import { useSshTerminal } from "../../hooks/useSshTerminal";
import { useRdpCanvas } from "../../hooks/useRdpCanvas";
import { credentials } from "../../utils/tauri";
import clsx from "clsx";

interface Props {
  session: Session;
  active: boolean;
}

export function SessionPanel({ session, active }: Props) {
  return (
    <div className={clsx("session-panel", active && "session-panel--active")}>
      {session.connection.connectionType === "ssh" ? (
        <SshPanel session={session} active={active} />
      ) : (
        <RdpPanel session={session} />
      )}
    </div>
  );
}

function SshPanel({ session, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { connect } = useSshTerminal({
    sessionId: session.id,
    connection: session.connection,
    containerRef,
  });

  useEffect(() => {
    if (!active) return;
    const init = async () => {
      let password: string | undefined;
      if (session.connection.authType === "password" && session.connection.credentialRef) {
        password = await credentials.get(session.connection.credentialRef).catch((e) => {
          console.error("credential fetch failed:", e);
          return undefined;
        });
      }
      await connect(password);
    };
    init().catch(console.error);
  }, []);

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
