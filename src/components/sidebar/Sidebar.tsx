import { useState, useRef, useEffect, useMemo } from "react";
import { Search, Plus, Monitor, Terminal, ChevronRight, ChevronDown, ChevronUp, ChevronsUp, ChevronsDown, Folder, FolderPlus, Layers, Settings, LockKeyhole, Key, Cpu } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Category, Connection, Group } from "../../types";
import { AddConnectionModal } from "../modals/AddConnectionModal";
import { EditGroupModal } from "../modals/EditGroupModal";
import { SettingsModal } from "../modals/SettingsModal";
import { TunnelList } from "./TunnelList";
import { credentials } from "../../utils/tauri";
import clsx from "clsx";

export function Sidebar({ onOpenAddModal }: { onOpenAddModal: () => void }) {
  const {
    connections, groups, categories, searchQuery,
    setSearchQuery, openSession, deleteConnection,
    addGroup, deleteGroup, addCategory, updateCategory, deleteCategory,
  } = useAppStore();

  // Group expand/collapse state is persisted in settings.json (see settingsStore).
  // Deriving from the store — rather than local state — means the persisted value
  // is applied automatically once settings finish loading after mount.
  const expandedGroupIds = useSettingsStore((s) => s.expandedGroupIds);
  const setExpandedGroupIds = useSettingsStore((s) => s.setExpandedGroupIds);
  const expandedGroups = useMemo(() => new Set(expandedGroupIds), [expandedGroupIds]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [renameCategoryName, setRenameCategoryName] = useState("");
  const groupInputRef = useRef<HTMLInputElement>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingGroup) groupInputRef.current?.focus();
  }, [addingGroup]);

  useEffect(() => {
    if (addingCategory) categoryInputRef.current?.focus();
  }, [addingCategory]);

  useEffect(() => {
    if (renamingCategoryId) renameInputRef.current?.focus();
  }, [renamingCategoryId]);

  // Expand new categories by default
  useEffect(() => {
    if (categories.length > 0) {
      setExpandedCategories((prev) => {
        const next = new Set(prev);
        categories.forEach((c) => next.add(c.id));
        return next;
      });
    }
  }, [categories.length]);

  const toggleGroup = (id: string) => {
    const next = new Set(expandedGroups);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedGroupIds([...next]);
  };

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allCollapsed = groups.length > 0 && expandedGroups.size === 0;
  const handleCollapseAll = () => setExpandedGroupIds([]);
  const handleExpandAll = () => setExpandedGroupIds(groups.map((g) => g.id));

  const handleAddGroup = async () => {
    const name = newGroupName.trim();
    if (!name) { setAddingGroup(false); return; }
    const added = await addGroup({ name, color: "#58a6ff" });
    setExpandedGroupIds([...expandedGroupIds, added.id]);
    setNewGroupName("");
    setAddingGroup(false);
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) { setAddingCategory(false); return; }
    const added = await addCategory({ name });
    setExpandedCategories((prev) => new Set(prev).add(added.id));
    setNewCategoryName("");
    setAddingCategory(false);
  };

  const handleRenameCategory = async (cat: Category) => {
    const name = renameCategoryName.trim();
    if (name && name !== cat.name) {
      await updateCategory({ ...cat, name });
    }
    setRenamingCategoryId(null);
  };

  const handleDeleteCategory = async (cat: Category) => {
    await deleteCategory(cat.id);
  };

  const handleDeleteGroup = async (group: Group) => {
    if (group.credentialRef) {
      await credentials.delete(group.credentialRef).catch(() => {});
    }
    await deleteGroup(group.id);
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

  // Separate groups by category membership
  const categorizedGroups = (catId: string) =>
    groups.filter((g) => g.categoryId === catId);
  const uncategorizedGroups = groups.filter((g) => !g.categoryId);

  return (
    <>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {editingGroup && <EditGroupModal group={editingGroup} onClose={() => setEditingGroup(null)} />}
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="app-title">SlimRDM</span>
          <div className="sidebar-header-actions">
            {groups.length > 0 && (
              <button
                className="icon-btn"
                onClick={allCollapsed ? handleExpandAll : handleCollapseAll}
                title={allCollapsed ? "Expand All" : "Collapse All"}
              >
                {allCollapsed ? <ChevronsDown size={15} /> : <ChevronsUp size={15} />}
              </button>
            )}
            <button className="icon-btn" onClick={() => setAddingCategory(true)} title="New Category">
              <Layers size={15} />
            </button>
            <button className="icon-btn" onClick={() => setAddingGroup(true)} title="New Group">
              <FolderPlus size={15} />
            </button>
            <button className="icon-btn" onClick={onOpenAddModal} title="New Connection">
              <Plus size={16} />
            </button>
          </div>
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
          {/* Categories with their groups */}
          {categories.map((cat) => {
            const catGroups = categorizedGroups(cat.id);
            const catConnCount = catGroups.reduce(
              (sum, g) => sum + filtered.filter((c) => c.groupId === g.id).length, 0
            );
            const expanded = expandedCategories.has(cat.id);
            const isRenaming = renamingCategoryId === cat.id;

            return (
              <CategorySection
                key={cat.id}
                category={cat}
                count={catConnCount}
                expanded={expanded}
                isRenaming={isRenaming}
                renameCategoryName={renameCategoryName}
                renameInputRef={renameInputRef}
                onToggle={() => toggleCategory(cat.id)}
                onStartRename={() => { setRenamingCategoryId(cat.id); setRenameCategoryName(cat.name); }}
                onRename={() => handleRenameCategory(cat)}
                onRenameChange={setRenameCategoryName}
                onDelete={() => handleDeleteCategory(cat)}
              >
                {expanded && catGroups.map((group) => (
                  <GroupSection
                    key={group.id}
                    group={group}
                    connections={filtered.filter((c) => c.groupId === group.id)}
                    expanded={expandedGroups.has(group.id)}
                    onToggle={() => toggleGroup(group.id)}
                    onEdit={() => setEditingGroup(group)}
                    onDelete={() => handleDeleteGroup(group)}
                    onOpen={openSession}
                    onDeleteConn={deleteConnection}
                    indented
                  />
                ))}
              </CategorySection>
            );
          })}

          {/* Uncategorized groups */}
          {uncategorizedGroups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              connections={filtered.filter((c) => c.groupId === group.id)}
              expanded={expandedGroups.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
              onEdit={() => setEditingGroup(group)}
              onDelete={() => handleDeleteGroup(group)}
              onOpen={openSession}
              onDeleteConn={deleteConnection}
            />
          ))}

          {/* Ungrouped connections */}
          {ungrouped.map((conn) => (
            <ConnectionItem key={conn.id} conn={conn} onOpen={openSession} onDelete={deleteConnection} />
          ))}

          {addingCategory && (
            <div className="new-category-row">
              <Layers size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <input
                ref={categoryInputRef}
                className="new-group-input"
                placeholder="Category name…"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCategory();
                  if (e.key === "Escape") { setAddingCategory(false); setNewCategoryName(""); }
                }}
                onBlur={handleAddCategory}
              />
            </div>
          )}

          {addingGroup && (
            <div className="new-group-row">
              <Folder size={13} style={{ color: "#58a6ff", flexShrink: 0 }} />
              <input
                ref={groupInputRef}
                className="new-group-input"
                placeholder="Group name…"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddGroup();
                  if (e.key === "Escape") { setAddingGroup(false); setNewGroupName(""); }
                }}
                onBlur={handleAddGroup}
              />
            </div>
          )}

          {filtered.length === 0 && !addingGroup && !addingCategory && (
            <div className="empty-list">
              {searchQuery ? "No results" : "No connections yet"}
            </div>
          )}
        </div>

        <TunnelList />

        <div className="sidebar-footer">
          <button className="icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
            <Settings size={15} />
          </button>
        </div>
      </aside>
    </>
  );
}

function CategorySection({
  category, count, expanded, isRenaming, renameCategoryName, renameInputRef,
  onToggle, onStartRename, onRename, onRenameChange, onDelete, children,
}: {
  category: Category;
  count: number;
  expanded: boolean;
  isRenaming: boolean;
  renameCategoryName: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  onToggle: () => void;
  onStartRename: () => void;
  onRename: () => void;
  onRenameChange: (v: string) => void;
  onDelete: () => void;
  children?: React.ReactNode;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="category-section">
      <div
        className="category-bar-wrap"
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setShowMenu(false);
        }}
        tabIndex={0}
      >
        <button className="category-bar" onClick={onToggle}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="category-rename-input"
              value={renameCategoryName}
              onChange={(e) => onRenameChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); onRename(); }
                if (e.key === "Escape") onRename();
              }}
              onBlur={onRename}
            />
          ) : (
            <span className="category-name">{category.name}</span>
          )}
          <span className="category-count">{count}</span>
        </button>
        {showMenu && (
          <div className="context-menu" onMouseDown={(e) => e.preventDefault()}>
            <button onClick={() => { onStartRename(); setShowMenu(false); }}>Rename</button>
            <button onClick={() => { onDelete(); setShowMenu(false); }} className="danger">Delete Category</button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function GroupSection({ group, connections, expanded, onToggle, onEdit, onDelete, onOpen, onDeleteConn, indented }: {
  group: Group;
  connections: Connection[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpen: (c: Connection) => void;
  onDeleteConn: (id: string) => void;
  indented?: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className={clsx("group-section", indented && "group-section--indented")}>
      <div
        className="group-header-wrap"
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
        onBlur={() => setShowMenu(false)}
        tabIndex={0}
      >
        <button className="group-header" onClick={onToggle}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Folder size={13} className="group-icon" style={{ color: group.color ?? "#58a6ff" }} />
          <span className="group-name">{group.name}</span>
          {group.privateKeyPath
            ? <span title="Group key auth"><Key size={9} className="auth-icon auth-icon--key" /></span>
            : group.credentialRef
              ? <span title="Group password auth"><LockKeyhole size={9} className="auth-icon auth-icon--password" /></span>
              : null}
          <span className="group-count">{connections.length}</span>
        </button>
        {showMenu && (
          <div className="context-menu" onMouseDown={(e) => e.preventDefault()}>
            <button onClick={() => { onEdit(); setShowMenu(false); }}>Edit Group</button>
            <button onClick={() => { onDelete(); setShowMenu(false); }} className="danger">
              Delete Group
            </button>
          </div>
        )}
      </div>
      {expanded && connections.map((conn) => (
        <ConnectionItem key={conn.id} conn={conn} onOpen={onOpen} onDelete={onDeleteConn} indent />
      ))}
    </div>
  );
}

function AuthIcon({ authType, useGroupCredentials }: { authType: string; useGroupCredentials?: boolean }) {
  if (useGroupCredentials) return <span title="Using group credentials"><ChevronUp size={9} className="auth-icon auth-icon--group" /></span>;
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
  const [duplicating, setDuplicating] = useState(false);
  const connType = conn.connectionType;
  const isRdp = connType === "rdp";
  const isTrm = connType === "trm";
  const session = useAppStore((s) => s.sessions.find((sess) => sess.connectionId === conn.id));
  const closeTab = useAppStore((s) => s.closeTab);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const groups = useAppStore((s) => s.groups);
  const connStatus = session?.status ?? "idle";

  // Highlight the item when its session belongs to the tab currently on screen
  // (mirrors the .tab--active accent in SessionTabs). With splits, every pane in
  // the visible tab shares the active tab's id, so all of them light up.
  const isActive = useAppStore((s) => {
    if (!session) return false;
    const activeTabId = s.sessions.find((sess) => sess.id === s.activeSessionId)?.tabId ?? s.activeSessionId;
    return activeTabId != null && (session.tabId ?? session.id) === activeTabId;
  });

  const displayUsername = conn.useGroupCredentials && conn.groupId
    ? (groups.find((g) => g.id === conn.groupId)?.username ?? conn.username)
    : conn.username;

  const handleDuplicate = () => {
    setDuplicating(true);
    setShowMenu(false);
  };

  const handleReconnect = () => {
    if (session) closeTab(session.tabId ?? session.id);
    onOpen(conn);
    setShowMenu(false);
  };

  return (
    <>
      {editing && <AddConnectionModal editing={conn} onClose={() => setEditing(false)} />}
      {duplicating && <AddConnectionModal prefill={conn} onClose={() => setDuplicating(false)} />}
      <div
        className={clsx("connection-item", indent && "connection-item--indented", isActive && "connection-item--active")}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
        onBlur={() => setShowMenu(false)}
        tabIndex={0}
      >
        <button
          className="connection-btn"
          onClick={session ? () => setActiveSession(session.id) : undefined}
          onDoubleClick={() => onOpen(conn)}
        >
          <span className={clsx("conn-icon", isRdp ? "conn-icon--rdp" : isTrm ? "conn-icon--trm" : "conn-icon--ssh", `conn-icon--${connStatus}`)}>
            {isRdp ? <Monitor size={13} /> : isTrm ? <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: -1 }}>$_</span> : <Terminal size={13} />}
          </span>
          <span className="conn-info">
            <span className="conn-label">{conn.label}</span>
            <span className="conn-host">
              {isTrm ? (
                conn.workingDirectory ?? "~"
              ) : (
                <>
                  <AuthIcon authType={conn.authType} useGroupCredentials={conn.useGroupCredentials} />
                  {displayUsername}@{conn.host}:{conn.port}
                </>
              )}
            </span>
          </span>
        </button>

        {showMenu && (
          <div className="context-menu" onMouseDown={(e) => e.preventDefault()}>
            <button onClick={() => { onOpen(conn); setShowMenu(false); }}>Connect</button>
            {session && <button onClick={handleReconnect}>Reconnect</button>}
            <button onClick={() => { setEditing(true); setShowMenu(false); }}>Edit</button>
            <button onClick={handleDuplicate}>Duplicate</button>
            <button onClick={async () => {
              if (conn.credentialRef) await credentials.delete(conn.credentialRef).catch(() => {});
              onDelete(conn.id);
              setShowMenu(false);
            }} className="danger">Delete</button>
          </div>
        )}
      </div>
    </>
  );
}
