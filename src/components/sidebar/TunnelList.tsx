import { useState } from "react";
import { Network, Plus, Play, Square, ChevronDown, ChevronRight } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { TunnelModal } from "../modals/TunnelModal";
import { TunnelConfig, TunnelRuntime } from "../../types";
import clsx from "clsx";

export function TunnelList() {
  const tunnelConfigs = useAppStore((s) => s.tunnelConfigs);
  const tunnelRuntimes = useAppStore((s) => s.tunnelRuntimes);
  const connectTunnel = useAppStore((s) => s.connectTunnel);
  const disconnectTunnel = useAppStore((s) => s.disconnectTunnel);
  const deleteTunnelConfig = useAppStore((s) => s.deleteTunnelConfig);
  const connections = useAppStore((s) => s.connections);

  const [expanded, setExpanded] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const activeCount = Object.values(tunnelRuntimes).filter(
    (r) => r.status === "active" || r.status === "connecting"
  ).length;

  return (
    <>
      {showModal && <TunnelModal onClose={() => setShowModal(false)} />}
      <div className="tunnel-section">
        <div className="tunnel-section-header">
          <button className="tunnel-section-toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <Network size={11} />
            <span>Tunnels</span>
            {activeCount > 0 && <span className="tunnel-count">{activeCount}</span>}
          </button>
          <button className="icon-btn tunnel-add-btn" title="New tunnel" onClick={() => setShowModal(true)}>
            <Plus size={13} />
          </button>
        </div>
        {expanded && (
          <div className="tunnel-list">
            {tunnelConfigs.length === 0 ? (
              <div className="tunnel-empty">No tunnels saved</div>
            ) : (
              tunnelConfigs.map((cfg) => (
                <TunnelItem
                  key={cfg.id}
                  config={cfg}
                  runtime={tunnelRuntimes[cfg.id]}
                  jumpHostLabel={connections.find((c) => c.id === cfg.jumpHostId)?.label}
                  onConnect={() => connectTunnel(cfg.id)}
                  onDisconnect={() => disconnectTunnel(cfg.id)}
                  onDelete={() => deleteTunnelConfig(cfg.id)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}

function TunnelItem({
  config, runtime, jumpHostLabel, onConnect, onDisconnect, onDelete,
}: {
  config: TunnelConfig;
  runtime: TunnelRuntime | undefined;
  jumpHostLabel: string | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [editing, setEditing] = useState(false);

  const status = runtime?.status ?? "stopped";
  const isActive = status === "active";
  const isConnecting = status === "connecting";
  const isRunning = isActive || isConnecting;

  const dotColor =
    isActive ? "var(--green)" :
    isConnecting ? "var(--yellow)" :
    status === "error" ? "var(--red)" :
    "var(--text-muted)";

  const addrLine = isActive && runtime?.activeLocalPort
    ? `localhost:${runtime.activeLocalPort} → ${config.remoteHost}:${config.remotePort}`
    : `${config.remoteHost}:${config.remotePort}${jumpHostLabel ? ` via ${jumpHostLabel}` : ""}`;

  return (
    <>
      {editing && <TunnelModal editing={config} onClose={() => setEditing(false)} />}
      <div
        className={clsx("tunnel-item", showMenu && "tunnel-item--menu-open")}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
        onBlur={() => setShowMenu(false)}
        tabIndex={0}
      >
        <span className="tunnel-status-dot" style={{ background: dotColor }} />
        <span className="tunnel-info">
          <span className="tunnel-label">{config.name}</span>
          <span className="tunnel-addr" title={addrLine}>{addrLine}</span>
        </span>
        <div className="tunnel-actions">
          {isRunning ? (
            <button className="tunnel-action-btn" title="Disconnect" onClick={onDisconnect}>
              <Square size={11} />
            </button>
          ) : (
            <button className="tunnel-action-btn" title="Connect" onClick={onConnect}>
              <Play size={11} />
            </button>
          )}
        </div>
        {showMenu && (
          <div className="context-menu context-menu--up" onMouseDown={(e) => e.preventDefault()}>
            {isRunning
              ? <button onClick={() => { onDisconnect(); setShowMenu(false); }}>Disconnect</button>
              : <button onClick={() => { onConnect(); setShowMenu(false); }}>Connect</button>
            }
            <button onClick={() => { setEditing(true); setShowMenu(false); }}>Edit</button>
            <button onClick={() => { onDelete(); setShowMenu(false); }} className="danger">Delete</button>
          </div>
        )}
      </div>
    </>
  );
}
