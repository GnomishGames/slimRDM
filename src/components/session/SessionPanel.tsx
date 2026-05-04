import { useRef, useEffect } from "react";
import { Session } from "../../types";
import { useSshTerminal } from "../../hooks/useSshTerminal";
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
  return (
    <div className="rdp-panel">
      <div className="rdp-status">
        <div className={clsx("rdp-status-dot", `rdp-status-dot--${session.status}`)} />
        <div className="rdp-status-info">
          <span className="rdp-status-label">
            {session.status === "connecting" && "Launching RDP client…"}
            {session.status === "connected" && "RDP session active in external window"}
            {session.status === "disconnected" && "Session closed"}
            {session.status === "error" && `Error: ${session.error}`}
          </span>
          <span className="rdp-status-host">
            {session.connection.username}@{session.connection.host}:{session.connection.port}
          </span>
        </div>
      </div>
      {session.status === "connected" && (
        <p className="rdp-note">
          RDP is managed by your system's native client (mstsc / xfreerdp).
          Close that window to end the session.
        </p>
      )}
    </div>
  );
}
