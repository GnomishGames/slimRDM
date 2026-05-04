import { useState } from "react";
import { Search, Plus, Monitor, Terminal, ChevronRight, ChevronDown, Folder, Settings } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { Connection } from "../../types";
import { credentials } from "../../utils/tauri";
import clsx from "clsx";

export function Sidebar() {
  const {
    connections, groups, searchQuery,
    setSearchQuery, openSession, deleteConnection,
  } = useAppStore();

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [_showAddModal, setShowAddModal] = useState(false);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = connections.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.label.toLowerCase().includes(q) ||
      c.host.toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q)
    );
  });

  const ungrouped = filtered.filter((c) => !c.groupId);
  const grouped = groups.map((g) => ({
    group: g,
    connections: filtered.filter((c) => c.groupId === g.id),
  }));

  const handleOpen = async (conn: Connection) => {
    const sessionId = openSession(conn);
    let password: string | undefined;

    if (conn.authType === "password" && conn.credentialRef) {
      try {
        password = await credentials.get(conn.credentialRef);
      } catch {
        password = undefined;
      }
    }

    if (conn.connectionType === "ssh") {
      const { ssh } = await import("../../utils/tauri");
      await ssh.connect({
        sessionId,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        authType: conn.authType,
        password,
        privateKeyPath: conn.privateKeyPath,
      });
    } else {
      const { rdp } = await import("../../utils/tauri");
      await rdp.connect({
        sessionId,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password,
      });
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="app-title">SlimRDM</span>
        <button className="icon-btn" onClick={() => setShowAddModal(true)} title="New Connection">
          <Plus size={16} />
        </button>
      </div>

      <div className="search-bar">
        <Search size={14} className="search-icon" />
        <input
          className="search-input"
          placeholder="Search connections..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="connection-list">
        {/* Ungrouped */}
        {ungrouped.map((conn) => (
          <ConnectionItem key={conn.id} conn={conn} onOpen={handleOpen} onDelete={deleteConnection} />
        ))}

        {/* Groups */}
        {grouped.map(({ group, connections: gc }) => (
          <div key={group.id} className="group-section">
            <button className="group-header" onClick={() => toggleGroup(group.id)}>
              {expandedGroups.has(group.id)
                ? <ChevronDown size={13} />
                : <ChevronRight size={13} />}
              <Folder size={13} className="group-icon" style={{ color: group.color ?? "#58a6ff" }} />
              <span className="group-name">{group.name}</span>
              <span className="group-count">{gc.length}</span>
            </button>
            {expandedGroups.has(group.id) && gc.map((conn) => (
              <ConnectionItem key={conn.id} conn={conn} onOpen={handleOpen} onDelete={deleteConnection} indent />
            ))}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="empty-list">
            {searchQuery ? "No results" : "No connections yet"}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="icon-btn" title="Settings">
          <Settings size={15} />
        </button>
      </div>
    </aside>
  );
}

function ConnectionItem({
  conn, onOpen, onDelete, indent
}: {
  conn: Connection;
  onOpen: (c: Connection) => void;
  onDelete: (id: string) => void;
  indent?: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const isRdp = conn.connectionType === "rdp";

  return (
    <div
      className={clsx("connection-item", indent && "connection-item--indented")}
      onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
      onBlur={() => setShowMenu(false)}
      tabIndex={0}
    >
      <button className="connection-btn" onDoubleClick={() => onOpen(conn)}>
        <span className={clsx("conn-icon", isRdp ? "conn-icon--rdp" : "conn-icon--ssh")}>
          {isRdp ? <Monitor size={13} /> : <Terminal size={13} />}
        </span>
        <span className="conn-info">
          <span className="conn-label">{conn.label}</span>
          <span className="conn-host">{conn.username}@{conn.host}:{conn.port}</span>
        </span>
      </button>

      {showMenu && (
        <div className="context-menu">
          <button onClick={() => { onOpen(conn); setShowMenu(false); }}>Connect</button>
          <button onClick={() => { onDelete(conn.id); setShowMenu(false); }} className="danger">Delete</button>
        </div>
      )}
    </div>
  );
}
