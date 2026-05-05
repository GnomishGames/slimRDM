import { useState } from "react";
import { Search, Plus, Monitor, Terminal, ChevronRight, ChevronDown, Folder, Settings, LockKeyhole, Key, Cpu } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { Connection } from "../../types";
import { AddConnectionModal } from "../modals/AddConnectionModal";
import clsx from "clsx";

export function Sidebar() {
  const {
    connections, groups, searchQuery,
    setSearchQuery, openSession, deleteConnection,
  } = useAppStore();

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);

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

  const handleOpen = (conn: Connection) => {
    openSession(conn);
  };

  return (
    <>
    {showAddModal && <AddConnectionModal onClose={() => setShowAddModal(false)} />}
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
    </>
  );
}

function AuthIcon({ authType }: { authType: string }) {
  if (authType === "public_key") return <span title="Public key"><Key size={9} className="auth-icon auth-icon--key" /></span>;
  if (authType === "agent")      return <span title="SSH agent"><Cpu size={9} className="auth-icon auth-icon--agent" /></span>;
  return <span title="Password"><LockKeyhole size={9} className="auth-icon auth-icon--password" /></span>;
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
  const [editing, setEditing] = useState(false);
  const isRdp = conn.connectionType === "rdp";

  return (
    <>
      {editing && <AddConnectionModal editing={conn} onClose={() => setEditing(false)} />}
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
            <span className="conn-host">
              <AuthIcon authType={conn.authType} />
              {conn.username}@{conn.host}:{conn.port}
            </span>
          </span>
        </button>

        {showMenu && (
          <div className="context-menu" onMouseDown={(e) => e.preventDefault()}>
            <button onClick={() => { onOpen(conn); setShowMenu(false); }}>Connect</button>
            <button onClick={() => { setEditing(true); setShowMenu(false); }}>Edit</button>
            <button onClick={() => { onDelete(conn.id); setShowMenu(false); }} className="danger">Delete</button>
          </div>
        )}
      </div>
    </>
  );
}
