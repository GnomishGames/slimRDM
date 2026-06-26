# Split Pane Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat split-view (Settings toggle + 1D session array) with a recursive binary split tree giving Tilix-style per-pane live split/close controls and 2×2 grid support.

**Architecture:** All `SessionPanel` components remain in the same flat `session-content` container at all times — moving them to a new DOM parent would remount xterm and kill connections. `computePaneLayout()` traverses the pane tree and produces absolute CSS positions for each panel, pane header, and divider, rendered as sibling overlays in the same container. No `SplitContainer` React component; layout is computed imperatively.

**Tech Stack:** React 18, TypeScript, Zustand, Tauri 2, lucide-react, clsx

## Global Constraints
- **No React StrictMode** — double-mount opens SSH connections twice (see CLAUDE.md)
- **SessionPanel must never remount** — keep all SessionPanel components as flat siblings in `session-content`; never move them to a new parent
- **Max 4 panes** — `splitPane` is a no-op when `countLeaves(paneRoot) >= 4`
- `MIN_RATIO = 0.1` — minimum pane size as a fraction (10%)
- `PANE_HEADER_H = 24` — pane header height in px
- `DIVIDER_PX = 4` — drag-handle thickness in px
- No `splitView` / `splitViewDirection` settings anywhere after this plan

---

### Task 1: Types + paneTree.ts

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/utils/paneTree.ts`

**Interfaces:**
- Produces: `PaneLeaf`, `PaneSplit`, `PaneNode` types; `PaneLayout`, `DividerLayout` types; functions `countLeaves`, `insertSplit`, `removeLeaf`, `updateRatio`, `firstLeafSessionId`, `computePaneLayout`

- [ ] **Step 1: Add pane tree types to `src/types/index.ts`**

In `src/types/index.ts`, add after the `Session` interface and remove `splitView`/`splitViewDirection` from `BehaviorSettings`:

```ts
// After the Session interface, add:
export interface PaneLeaf {
  type: "leaf";
  sessionId: string;
}

export interface PaneSplit {
  type: "split";
  // vertical = left|right (vertical divider line)
  // horizontal = top|bottom (horizontal divider line)
  direction: "vertical" | "horizontal";
  ratio: number; // 0–1, fraction of space given to `first`
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;
```

Also update `BehaviorSettings` — remove the two split fields:

```ts
export interface BehaviorSettings {
  copyOnSelect: boolean;
  confirmCloseTab: boolean;
  autoReconnect: boolean;
  // splitView and splitViewDirection removed
}
```

- [ ] **Step 2: Create `src/utils/paneTree.ts`**

```ts
import type { CSSProperties } from "react";
import type { PaneLeaf, PaneNode, PaneSplit } from "../types";

export const PANE_HEADER_H = 24;
const DIVIDER_PX = 4;
const MIN_RATIO = 0.1;

// ── Tree operations ────────────────────────────────────────

export function countLeaves(node: PaneNode): number {
  if (node.type === "leaf") return 1;
  return countLeaves(node.first) + countLeaves(node.second);
}

export function firstLeafSessionId(node: PaneNode): string {
  if (node.type === "leaf") return node.sessionId;
  return firstLeafSessionId(node.first);
}

export function insertSplit(
  root: PaneNode,
  targetId: string,
  direction: "vertical" | "horizontal",
  newSessionId: string
): PaneNode {
  if (root.type === "leaf") {
    if (root.sessionId !== targetId) return root;
    const newLeaf: PaneLeaf = { type: "leaf", sessionId: newSessionId };
    const split: PaneSplit = { type: "split", direction, ratio: 0.5, first: root, second: newLeaf };
    return split;
  }
  return {
    ...root,
    first: insertSplit(root.first, targetId, direction, newSessionId),
    second: insertSplit(root.second, targetId, direction, newSessionId),
  };
}

export function removeLeaf(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === "leaf") return node.sessionId === sessionId ? null : node;
  const newFirst = removeLeaf(node.first, sessionId);
  const newSecond = removeLeaf(node.second, sessionId);
  if (newFirst === null) return newSecond;
  if (newSecond === null) return newFirst;
  return { ...node, first: newFirst, second: newSecond };
}

export function updateRatio(
  node: PaneNode,
  path: ("first" | "second")[],
  ratio: number
): PaneNode {
  if (path.length === 0) {
    if (node.type !== "split") return node;
    return { ...node, ratio: Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, ratio)) };
  }
  if (node.type !== "split") return node;
  const [step, ...rest] = path;
  return { ...node, [step]: updateRatio(node[step], rest, ratio) };
}

// ── Layout computation ─────────────────────────────────────

export interface DividerLayout {
  direction: "vertical" | "horizontal";
  path: ("first" | "second")[];
  ratio: number;
  /** Percentage width of this split node in the container (for drag math). */
  nodeW: number;
  /** Percentage height of this split node in the container (for drag math). */
  nodeH: number;
  style: CSSProperties;
}

export interface PaneLayout {
  /** Absolute CSS style for each SessionPanel (below the pane header). */
  panelStyles: Map<string, CSSProperties>;
  /** Absolute CSS style for each PaneHeader overlay. */
  headerStyles: Map<string, CSSProperties>;
  dividers: DividerLayout[];
}

/**
 * Traverses the pane tree and computes absolute CSS positions for all panels,
 * headers, and dividers. x/y/w/h are percentage values (0–100).
 */
export function computePaneLayout(root: PaneNode): PaneLayout {
  const panelStyles = new Map<string, CSSProperties>();
  const headerStyles = new Map<string, CSSProperties>();
  const dividers: DividerLayout[] = [];

  function traverse(
    node: PaneNode,
    x: number,
    y: number,
    w: number,
    h: number,
    path: ("first" | "second")[]
  ) {
    if (node.type === "leaf") {
      headerStyles.set(node.sessionId, {
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: `${w}%`,
        height: PANE_HEADER_H,
        zIndex: 5,
      });
      panelStyles.set(node.sessionId, {
        position: "absolute",
        left: `${x}%`,
        top: `calc(${y}% + ${PANE_HEADER_H}px)`,
        width: `${w}%`,
        height: `calc(${h}% - ${PANE_HEADER_H}px)`,
      });
      return;
    }

    if (node.direction === "vertical") {
      const firstW = w * node.ratio;
      const secondW = w * (1 - node.ratio);
      traverse(node.first, x, y, firstW, h, [...path, "first"]);
      traverse(node.second, x + firstW, y, secondW, h, [...path, "second"]);
      dividers.push({
        direction: "vertical",
        path,
        ratio: node.ratio,
        nodeW: w,
        nodeH: h,
        style: {
          position: "absolute",
          left: `${x + firstW}%`,
          top: `${y}%`,
          width: DIVIDER_PX,
          height: `${h}%`,
          transform: "translateX(-50%)",
          zIndex: 10,
        },
      });
    } else {
      const firstH = h * node.ratio;
      const secondH = h * (1 - node.ratio);
      traverse(node.first, x, y, w, firstH, [...path, "first"]);
      traverse(node.second, x, y + firstH, w, secondH, [...path, "second"]);
      dividers.push({
        direction: "horizontal",
        path,
        ratio: node.ratio,
        nodeW: w,
        nodeH: h,
        style: {
          position: "absolute",
          left: `${x}%`,
          top: `${y + firstH}%`,
          width: `${w}%`,
          height: DIVIDER_PX,
          transform: "translateY(-50%)",
          zIndex: 10,
        },
      });
    }
  }

  traverse(root, 0, 0, 100, 100, []);
  return { panelStyles, headerStyles, dividers };
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: only errors in `appStore.ts` and `settingsStore.ts` which reference the removed fields — those are fixed in Tasks 2 and 3.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/utils/paneTree.ts
git commit -m "feat: add pane tree types and layout utilities"
```

---

### Task 2: Update appStore.ts

**Files:**
- Modify: `src/store/appStore.ts`

**Interfaces:**
- Consumes: `PaneNode`, `PaneLeaf`, `PaneSplit` from `src/types/index.ts`; `countLeaves`, `insertSplit`, `removeLeaf`, `updateRatio`, `firstLeafSessionId` from `src/utils/paneTree.ts`
- Produces: `paneRoot: PaneNode | null`, `splitPane(sessionId, direction)`, `closePane(sessionId)`, `setPaneRatio(path, ratio)` on `useAppStore`

- [ ] **Step 1: Replace the entire `src/store/appStore.ts`**

```ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  Category, Connection, Group, PaneNode, Session, SessionStatus,
  TunnelConfig, TunnelRuntime, TunnelStatus,
} from "../types";
import { tunnels as tunnelsApi } from "../utils/tauri";
import {
  countLeaves, firstLeafSessionId, insertSplit, removeLeaf, updateRatio,
} from "../utils/paneTree";

interface AppState {
  // Data
  connections: Connection[];
  groups: Group[];
  categories: Category[];
  sessions: Session[];
  activeSessionId: string | null;
  paneRoot: PaneNode | null;

  // Tunnels
  tunnelConfigs: TunnelConfig[];
  tunnelRuntimes: Record<string, TunnelRuntime>;

  // UI
  searchQuery: string;
  selectedGroupId: string | null;
  sidebarWidth: number;

  // Actions
  loadConnections: () => Promise<void>;
  loadGroups: () => Promise<void>;
  loadCategories: () => Promise<void>;
  addConnection: (conn: Omit<Connection, "id" | "createdAt">) => Promise<Connection>;
  updateConnection: (conn: Connection) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  addGroup: (group: Omit<Group, "id">) => Promise<Group>;
  updateGroup: (group: Group) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  addCategory: (cat: { name: string }) => Promise<Category>;
  updateCategory: (cat: Category) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  loadTunnelConfigs: () => Promise<void>;
  addTunnelConfig: (params: { name: string; jumpHostId: string; remoteHost: string; remotePort: number; localPort: number }) => Promise<TunnelConfig>;
  editTunnelConfig: (config: { id: string; name: string; jumpHostId: string; remoteHost: string; remotePort: number; localPort: number }) => Promise<void>;
  deleteTunnelConfig: (id: string) => Promise<void>;
  connectTunnel: (configId: string) => Promise<void>;
  disconnectTunnel: (configId: string) => Promise<void>;
  updateTunnelRuntime: (id: string, patch: Partial<TunnelRuntime>) => void;
  clearTunnelRuntime: (id: string) => void;

  openSession: (connection: Connection) => string;
  closeSession: (sessionId: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus, error?: string) => void;
  setActiveSession: (sessionId: string | null) => void;

  splitPane: (sessionId: string, direction: "vertical" | "horizontal") => void;
  closePane: (sessionId: string) => void;
  setPaneRatio: (path: ("first" | "second")[], ratio: number) => void;

  setSearchQuery: (q: string) => void;
  setSelectedGroup: (id: string | null) => void;
}

function resolveJumpHostParams(conn: Connection, groups: Group[]) {
  let { username, authType, credentialRef, privateKeyPath } = conn;
  if (conn.useGroupCredentials && conn.groupId) {
    const group = groups.find((g) => g.id === conn.groupId);
    if (group?.username) {
      username = group.username;
      authType = group.authType ?? "password";
      credentialRef = group.credentialRef;
      privateKeyPath = group.privateKeyPath;
    }
  }
  return { host: conn.host, port: conn.port, username, authType, credentialRef, privateKeyPath };
}

export const useAppStore = create<AppState>((set, get) => ({
  connections: [],
  groups: [],
  categories: [],
  sessions: [],
  tunnelConfigs: [],
  tunnelRuntimes: {},
  activeSessionId: null,
  paneRoot: null,
  searchQuery: "",
  selectedGroupId: null,
  sidebarWidth: 260,

  loadConnections: async () => {
    const connections = await invoke<Connection[]>("list_connections");
    set({ connections });
  },

  loadGroups: async () => {
    const groups = await invoke<Group[]>("list_groups");
    set({ groups });
  },

  loadCategories: async () => {
    const categories = await invoke<Category[]>("list_categories");
    set({ categories });
  },

  addConnection: async (conn) => {
    const added = await invoke<Connection>("add_connection", { connection: conn });
    set((s) => {
      const connections = [...s.connections, added];
      connections.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
      return { connections };
    });
    return added;
  },

  updateConnection: async (conn) => {
    const updated = await invoke<Connection>("update_connection", { connection: conn });
    set((s) => {
      const connections = s.connections.map((c) => (c.id === updated.id ? updated : c));
      connections.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
      return { connections };
    });
  },

  deleteConnection: async (id) => {
    await invoke("delete_connection", { id });
    set((s) => ({ connections: s.connections.filter((c) => c.id !== id) }));
  },

  addGroup: async (group) => {
    const added = await invoke<Group>("add_group", { group });
    set((s) => {
      const groups = [...s.groups, added];
      groups.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return { groups };
    });
    return added;
  },

  updateGroup: async (group) => {
    const updated = await invoke<Group>("update_group", { group });
    set((s) => {
      const groups = s.groups.map((g) => (g.id === updated.id ? updated : g));
      groups.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return { groups };
    });
  },

  deleteGroup: async (id) => {
    await invoke("delete_group", { id });
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      connections: s.connections.map((c) =>
        c.groupId === id ? { ...c, groupId: undefined } : c
      ),
    }));
  },

  addCategory: async (cat) => {
    const added = await invoke<Category>("add_category", { category: cat });
    set((s) => ({ categories: [...s.categories, added] }));
    return added;
  },

  updateCategory: async (cat) => {
    const updated = await invoke<Category>("update_category", { category: cat });
    set((s) => ({ categories: s.categories.map((c) => (c.id === updated.id ? updated : c)) }));
  },

  deleteCategory: async (id) => {
    await invoke("delete_category", { id });
    set((s) => ({
      categories: s.categories.filter((c) => c.id !== id),
      groups: s.groups.map((g) => g.categoryId === id ? { ...g, categoryId: undefined } : g),
    }));
  },

  loadTunnelConfigs: async () => {
    const configs = await tunnelsApi.listConfigs();
    set({ tunnelConfigs: configs });
  },

  addTunnelConfig: async ({ name, jumpHostId, remoteHost, remotePort, localPort }) => {
    const displayName = name.trim() || `${remoteHost}:${remotePort}`;
    const cfg = await tunnelsApi.addConfig({ name: displayName, jumpHostId, remoteHost, remotePort, localPort });
    set((s) => ({ tunnelConfigs: [...s.tunnelConfigs, cfg] }));
    return cfg;
  },

  editTunnelConfig: async (config) => {
    const updated = await tunnelsApi.updateConfig(config);
    set((s) => ({ tunnelConfigs: s.tunnelConfigs.map((c) => c.id === updated.id ? updated : c) }));
  },

  deleteTunnelConfig: async (id) => {
    await tunnelsApi.deleteConfig(id);
    set((s) => {
      const tunnelRuntimes = { ...s.tunnelRuntimes };
      delete tunnelRuntimes[id];
      return { tunnelConfigs: s.tunnelConfigs.filter((c) => c.id !== id), tunnelRuntimes };
    });
  },

  connectTunnel: async (configId) => {
    const { tunnelConfigs, connections, groups } = get();
    const cfg = tunnelConfigs.find((c) => c.id === configId);
    if (!cfg) throw new Error("Tunnel config not found");
    const jumpConn = connections.find((c) => c.id === cfg.jumpHostId);
    if (!jumpConn) throw new Error("Jump host connection not found");
    const jumpHostParams = resolveJumpHostParams(jumpConn, groups);
    set((s) => ({ tunnelRuntimes: { ...s.tunnelRuntimes, [configId]: { status: "connecting" as TunnelStatus } } }));
    await tunnelsApi.open({ id: configId, name: cfg.name, jumpHostParams, localPort: cfg.localPort, remoteHost: cfg.remoteHost, remotePort: cfg.remotePort });
  },

  disconnectTunnel: async (id) => {
    await tunnelsApi.close(id);
    set((s) => ({ tunnelRuntimes: { ...s.tunnelRuntimes, [id]: { status: "stopped" as TunnelStatus } } }));
  },

  updateTunnelRuntime: (id, patch) => {
    set((s) => ({
      tunnelRuntimes: { ...s.tunnelRuntimes, [id]: { ...s.tunnelRuntimes[id], ...patch } },
    }));
  },

  clearTunnelRuntime: (id) => {
    set((s) => {
      const tunnelRuntimes = { ...s.tunnelRuntimes };
      delete tunnelRuntimes[id];
      return { tunnelRuntimes };
    });
  },

  openSession: (connection) => {
    const sessionId = `${connection.id}-${Date.now()}`;
    const session: Session = {
      id: sessionId,
      connectionId: connection.id,
      connection,
      status: "connecting",
      openedAt: Date.now(),
    };
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
    return sessionId;
  },

  closeSession: (sessionId) => {
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== sessionId);
      const activeSessionId =
        s.activeSessionId === sessionId
          ? sessions[sessions.length - 1]?.id ?? null
          : s.activeSessionId;
      return { sessions, activeSessionId };
    });
  },

  setSessionStatus: (sessionId, status, error) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status, error } : sess
      ),
    }));
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  splitPane: (sessionId, direction) => {
    set((s) => {
      if (s.paneRoot && countLeaves(s.paneRoot) >= 4) return {};
      const session = s.sessions.find((sess) => sess.id === sessionId);
      if (!session) return {};

      const newSessionId = `${session.connection.id}-${Date.now()}`;
      const newSession: Session = {
        id: newSessionId,
        connectionId: session.connection.id,
        connection: session.connection,
        status: "connecting",
        openedAt: Date.now(),
      };

      const baseRoot: PaneNode = s.paneRoot ?? { type: "leaf", sessionId };
      const newRoot = insertSplit(baseRoot, sessionId, direction, newSessionId);

      return {
        sessions: [...s.sessions, newSession],
        paneRoot: newRoot,
        activeSessionId: newSessionId,
      };
    });
  },

  closePane: (sessionId) => {
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== sessionId);
      const newRoot = s.paneRoot ? removeLeaf(s.paneRoot, sessionId) : null;

      // Exit split mode when only one pane remains
      const paneRoot = newRoot?.type === "split" ? newRoot : null;

      let activeSessionId = s.activeSessionId;
      if (activeSessionId === sessionId) {
        activeSessionId = newRoot
          ? firstLeafSessionId(newRoot)
          : sessions[sessions.length - 1]?.id ?? null;
      }

      return { sessions, paneRoot, activeSessionId };
    });
  },

  setPaneRatio: (path, ratio) => {
    set((s) => {
      if (!s.paneRoot) return {};
      return { paneRoot: updateRatio(s.paneRoot, path, ratio) };
    });
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedGroup: (id) => set({ selectedGroupId: id }),
}));
```

Note: `connectTunnel` now uses `get()` instead of `useAppStore.getState()`. Add `get` to the `create` callback parameters (already changed in the signature above with `(set, get)`).

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: errors in `settingsStore.ts` (splitView fields), `App.tsx` (old split logic), and `SettingsModal.tsx` — fixed in Tasks 3 and 6.

- [ ] **Step 3: Commit**

```bash
git add src/store/appStore.ts
git commit -m "feat: replace splitSessionIds with paneRoot binary split tree in appStore"
```

---

### Task 3: Settings cleanup — settingsStore.ts + SettingsModal.tsx

**Files:**
- Modify: `src/store/settingsStore.ts`
- Modify: `src/components/modals/SettingsModal.tsx`

**Interfaces:**
- Consumes: updated `BehaviorSettings` from Task 1 (no `splitView`/`splitViewDirection`)

- [ ] **Step 1: Update `src/store/settingsStore.ts`**

Replace `DEFAULT_BEHAVIOR`:
```ts
export const DEFAULT_BEHAVIOR: BehaviorSettings = {
  copyOnSelect: false,
  confirmCloseTab: false,
  autoReconnect: false,
};
```

The `setBehavior`, `load`, and store persistence logic need no other changes — the spread merge (`{ ...DEFAULT_BEHAVIOR, ...savedBehavior }`) will silently drop the removed fields from any persisted data.

- [ ] **Step 2: Remove split UI from `src/components/modals/SettingsModal.tsx`**

In `BehaviorSection`, find and remove two things:

**Remove** `"splitView"` from the `BoolKey` union type and the `rows` array entry for it:
```ts
// Remove from BoolKey:
type BoolKey = "copyOnSelect" | "confirmCloseTab" | "autoReconnect";

// Remove this entry from rows[]:
{
  key: "splitView",
  label: "Split View",
  help: "Show up to 3 terminals at once...",
},
```

**Remove** the entire conditional block that renders split direction:
```tsx
// Delete this entire block:
{behavior.splitView && (
  <div>
    <div className="settings-group">
      <label className="settings-row-label">Split Direction</label>
      <div className="type-toggle">
        ...
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: errors now only in `App.tsx` which still references old split variables — fixed in Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/store/settingsStore.ts src/components/modals/SettingsModal.tsx
git commit -m "chore: remove splitView/splitViewDirection settings"
```

---

### Task 4: PaneHeader component

**Files:**
- Create: `src/components/session/PaneHeader.tsx`

**Interfaces:**
- Consumes: `Session` from `src/types/index.ts`; `splitPane`, `closePane`, `setActiveSession` from `useAppStore`
- Produces: `<PaneHeader>` component used in Task 6 (App.tsx)

- [ ] **Step 1: Create `src/components/session/PaneHeader.tsx`**

```tsx
import type { CSSProperties } from "react";
import { useCallback } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import type { Session } from "../../types";
import { useAppStore } from "../../store/appStore";

// Lucide icon for vertical split (adds pane to the right).
// Use Columns2 if available in your lucide-react version, otherwise PanelLeft.
import { Columns2, Rows2 } from "lucide-react";

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
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
}
```

> **Icon note:** If `Columns2` / `Rows2` are not available in your installed lucide-react version, use `PanelLeft` / `PanelTop` as alternatives. Run `node -e "require('lucide-react')" 2>/dev/null | head` or check `node_modules/lucide-react/dist/lucide-react.d.ts` to confirm available icons.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors from this file (may still have App.tsx errors from Task 2/3).

- [ ] **Step 3: Commit**

```bash
git add src/components/session/PaneHeader.tsx
git commit -m "feat: add PaneHeader component for split pane chrome"
```

---

### Task 5: SplitDivider component

**Files:**
- Create: `src/components/session/SplitDivider.tsx`

**Interfaces:**
- Consumes: `DividerLayout` from `src/utils/paneTree.ts`; `setPaneRatio` from `useAppStore`; `contentRef: RefObject<HTMLDivElement>` passed from App.tsx
- Produces: `<SplitDivider>` component used in Task 6 (App.tsx)

- [ ] **Step 1: Create `src/components/session/SplitDivider.tsx`**

```tsx
import type { CSSProperties, RefObject } from "react";
import { useCallback } from "react";
import { useAppStore } from "../../store/appStore";

const MIN_RATIO = 0.1;

interface Props {
  direction: "vertical" | "horizontal";
  path: ("first" | "second")[];
  ratio: number;
  /** Percentage width of the split node (used to convert px delta → ratio). */
  nodeW: number;
  /** Percentage height of the split node (used to convert px delta → ratio). */
  nodeH: number;
  style: CSSProperties;
  /** Ref to session-content div — used to measure container size for drag math. */
  contentRef: RefObject<HTMLDivElement>;
}

export function SplitDivider({
  direction,
  path,
  ratio,
  nodeW,
  nodeH,
  style,
  contentRef,
}: Props) {
  const setPaneRatio = useAppStore((s) => s.setPaneRatio);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = contentRef.current;
      if (!container) return;

      const isVert = direction === "vertical";
      const startPos = isVert ? e.clientX : e.clientY;
      const containerPx = isVert ? container.offsetWidth : container.offsetHeight;
      // The node occupies nodeW% (vert) or nodeH% (horiz) of the container.
      const nodeSizePx = containerPx * (isVert ? nodeW : nodeH) / 100;
      const startRatio = ratio;

      const onMove = (ev: MouseEvent) => {
        if (nodeSizePx <= 0) return;
        const delta = (isVert ? ev.clientX : ev.clientY) - startPos;
        const newRatio = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, startRatio + delta / nodeSizePx));
        setPaneRatio(path, newRatio);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [direction, nodeW, nodeH, ratio, path, setPaneRatio, contentRef]
  );

  return (
    <div
      className={direction === "vertical" ? "pane-divider-v" : "pane-divider-h"}
      style={style}
      onMouseDown={handleMouseDown}
    />
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/session/SplitDivider.tsx
git commit -m "feat: add SplitDivider drag-resize component"
```

---

### Task 6: App.tsx wiring + styles.css

This is the main assembly task. It replaces all old split logic in App.tsx and updates CSS.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `PaneHeader` (Task 4), `SplitDivider` (Task 5), `computePaneLayout`, `countLeaves`, `PANE_HEADER_H` from `paneTree.ts`, `paneRoot`, `splitPane`, `closePane`, `setPaneRatio` from `useAppStore`

- [ ] **Step 1: Replace `src/App.tsx` entirely**

```tsx
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/sidebar/Sidebar";
import { SessionTabs } from "./components/session/SessionTabs";
import { SessionPanel } from "./components/session/SessionPanel";
import { PaneHeader } from "./components/session/PaneHeader";
import { SplitDivider } from "./components/session/SplitDivider";
import { AddConnectionModal } from "./components/modals/AddConnectionModal";
import { useAppStore } from "./store/appStore";
import { useSettingsStore } from "./store/settingsStore";
import { updates, UpdateInfo } from "./utils/tauri";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { computePaneLayout, countLeaves } from "./utils/paneTree";
import "./styles.css";

export default function App() {
  const {
    loadConnections, loadGroups, loadCategories,
    sessions, activeSessionId, paneRoot,
    splitPane, closePane, setPaneRatio, setActiveSession,
    updateTunnelRuntime, clearTunnelRuntime, loadTunnelConfigs,
    setSearchQuery,
  } = useAppStore();
  const loadSettings = useSettingsStore((s) => s.load);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeIdRef = useRef(activeSessionId);
  activeIdRef.current = activeSessionId;

  const contentRef = useRef<HTMLDivElement>(null);

  const isSplit = paneRoot !== null && paneRoot.type === "split";

  const paneLayout = useMemo(
    () => (isSplit && paneRoot ? computePaneLayout(paneRoot) : null),
    [paneRoot, isSplit]
  );

  const leafCount = paneRoot ? countLeaves(paneRoot) : 0;

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

  // Ctrl+PageUp/Down tab cycling (single-session mode only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || sessionsRef.current.length < 2) return;
      if (e.key !== "PageDown" && e.key !== "PageUp") return;
      if (isSplit) return;
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
  }, [isSplit]);

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
              {!isSplit && <SessionTabs />}
              {/*
                All session panels live in the same container at all times.
                Moving them to a different parent remounts xterm and kills connections.
                In split mode: absolute positioning places each panel in its pane slot.
                In single mode: display:none hides non-active panels (existing behaviour).
              */}
              <div ref={contentRef} className="session-content">
                {sessions.map((session) => {
                  const panelStyle = paneLayout?.panelStyles.get(session.id);
                  const inTree = isSplit ? panelStyle !== undefined : false;
                  const active = isSplit ? inTree : session.id === activeSessionId;
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

                {isSplit && paneLayout && (
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
                    {paneLayout.dividers.map((d, i) => (
                      <SplitDivider
                        key={`div-${i}`}
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
```

- [ ] **Step 2: Update `src/styles.css` — add pane chrome classes, remove old split-divider classes**

Find and **delete** this block (lines ~658–684):
```css
/* Drag handle between split panes */
.split-divider { ... }
.split-divider--vertical { ... }
.split-divider--horizontal { ... }
.split-divider:hover, .split-divider:active { ... }
```

**Add** at the end of the Session Content section (after `.session-panel--active`):

```css
/* ── Pane Chrome (split mode) ────────────────────────────── */
.pane-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  user-select: none;
  cursor: default;
}

.pane-header--focused {
  border-bottom-color: var(--accent);
}

.pane-header-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pane-header-label {
  flex: 1;
  font-size: 11px;
  font-family: var(--font-ui);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-header--focused .pane-header-label {
  color: var(--text-primary);
}

.pane-header-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.pane-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  padding: 2px;
  transition: background 0.1s, color 0.1s;
}

.pane-header-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.pane-header-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pane-divider-v {
  cursor: col-resize;
  background: var(--border);
}

.pane-divider-h {
  cursor: row-resize;
  background: var(--border);
}

.pane-divider-v:hover,
.pane-divider-v:active,
.pane-divider-h:hover,
.pane-divider-h:active {
  background: var(--accent);
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Run the app and verify single-session mode is unchanged**

```bash
source ~/.cargo/env && npm run tauri dev
```

Check:
- Open a connection → tab bar appears, terminal fills the window
- Switch tabs, close tabs — all work as before
- Settings modal → Behavior section has no Split View row

- [ ] **Step 5: Verify split mode — basic 2-pane**

In the running app:
- Open an SSH connection
- Click the "⊞|" (split vertical) button in the tab bar (added in Task 7 — if Task 7 is not done yet, temporarily call `useAppStore.getState().splitPane(activeId, "vertical")` from the browser console)
- Two panes appear side by side, each with a pane header
- Drag the divider → panes resize
- Click `✕` in one pane header → single session mode resumes, tab bar returns

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "feat: wire pane layout overlays into App.tsx and update CSS"
```

---

### Task 7: SessionTabs — add split entry buttons

**Files:**
- Modify: `src/components/session/SessionTabs.tsx`

**Interfaces:**
- Consumes: `splitPane`, `activeSessionId`, `paneRoot` from `useAppStore`
- Produces: updated `<SessionTabs>` with split-entry buttons on the right

- [ ] **Step 1: Replace `src/components/session/SessionTabs.tsx`**

```tsx
import { X, Monitor, Terminal } from "lucide-react";
import { Columns2, Rows2 } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Session } from "../../types";
import { countLeaves } from "../../utils/paneTree";
import clsx from "clsx";

export function SessionTabs() {
  const { sessions, activeSessionId, paneRoot, splitPane, setActiveSession, closeSession } = useAppStore();
  const leafCount = paneRoot ? countLeaves(paneRoot) : 0;
  const canSplit = leafCount < 4 && activeSessionId !== null;

  return (
    <div className="tab-bar">
      {sessions.map((session) => (
        <Tab
          key={session.id}
          session={session}
          active={session.id === activeSessionId}
          onActivate={() => setActiveSession(session.id)}
          onClose={() => closeSession(session.id)}
        />
      ))}
      <div className="tab-bar-split-actions">
        <button
          className="tab-split-btn"
          title="Split right"
          disabled={!canSplit}
          onClick={() => activeSessionId && splitPane(activeSessionId, "vertical")}
        >
          <Columns2 size={13} />
        </button>
        <button
          className="tab-split-btn"
          title="Split down"
          disabled={!canSplit}
          onClick={() => activeSessionId && splitPane(activeSessionId, "horizontal")}
        >
          <Rows2 size={13} />
        </button>
      </div>
    </div>
  );
}

function Tab({
  session, active, onActivate, onClose,
}: {
  session: Session;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const connType = session.connection.connectionType;
  const statusColor = {
    connecting: "#d29922",
    connected: "#3fb950",
    disconnected: "#6e7681",
    error: "#ff7b72",
  }[session.status];

  return (
    <button
      className={clsx("tab", active && "tab--active")}
      onClick={onActivate}
    >
      <span className="tab-icon">
        {connType === "rdp"
          ? <Monitor size={12} />
          : connType === "trm"
          ? <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: -1 }}>$_</span>
          : <Terminal size={12} />}
      </span>
      <span className="tab-dot" style={{ background: statusColor }} />
      <span className="tab-label">{session.connection.label}</span>
      <button
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation();
          const { behavior } = useSettingsStore.getState();
          if (behavior.confirmCloseTab && !window.confirm(`Close "${session.connection.label}"?`)) return;
          onClose();
        }}
      >
        <X size={11} />
      </button>
    </button>
  );
}
```

- [ ] **Step 2: Add CSS for split entry buttons to `src/styles.css`**

Add inside the `/* ── Tab Bar ── */` section, after `.tab-close:hover`:

```css
.tab-bar-split-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  padding: 0 6px;
  flex-shrink: 0;
}

.tab-split-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  padding: 3px;
  transition: background 0.1s, color 0.1s;
}

.tab-split-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tab-split-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Run the app and do a full end-to-end test**

```bash
source ~/.cargo/env && npm run tauri dev
```

**Test checklist:**
1. Open a connection → tab bar shows split buttons on the right (right-hand `⊞|` and `⊟—` icons)
2. Click "split right" → two panes appear, right pane connects to the same host
3. Both panes show pane headers (connection label + status dot + split + close buttons)
4. Drag the vertical divider → panes resize smoothly
5. Click "split down" on the left pane → 3 panes (left-top, left-bottom, right)
6. Click "split right" on any pane → 4 panes (2×2 grid)
7. Split buttons disabled when 4 panes are open
8. Click `✕` on one pane → that session closes, remaining panes fill the space
9. Close panes until 1 remains → tab bar reappears, single-session mode resumes
10. Open settings → no Split View row in Behavior section

- [ ] **Step 5: Commit**

```bash
git add src/components/session/SessionTabs.tsx src/styles.css
git commit -m "feat: add split entry buttons to tab bar"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Per-pane split right/split down buttons | Task 4 (PaneHeader), Task 7 (SessionTabs entry) |
| Splitting duplicates same connection | Task 2 (splitPane creates new Session from same connection) |
| Panes resizable by dragging dividers | Task 5 (SplitDivider) |
| Hard limit of 4 panes | Task 2 (`countLeaves >= 4` guard), Task 4 (`canSplit` prop) |
| Tab bar hidden in split mode | Task 6 (`!isSplit && <SessionTabs />`) |
| Pane headers in split mode | Task 4, Task 6 (rendered as overlays) |
| Single-session mode unchanged | Task 6 (flat render path unchanged) |
| Remove splitView/splitViewDirection settings | Task 1, Task 3 |
| Close pane → sibling expands, session disconnected | Task 2 (closePane) |
| 2×2 grid via recursive splitting | Task 1 (insertSplit supports nesting), Task 2, Task 6 |

**Architecture note:** The spec proposed `SplitContainer` as a React component wrapping `SessionPanel`. This was revised in the plan because moving `SessionPanel` to a new DOM parent remounts xterm and kills connections. Instead, all session panels stay flat in `session-content` and layout is computed via `computePaneLayout()`. The result is the same UX with no remounting risk.

**No placeholders detected.**

**Type consistency:** `splitPane(sessionId: string, direction: "vertical" | "horizontal")` and `closePane(sessionId: string)` and `setPaneRatio(path: ("first"|"second")[], ratio: number)` are consistent across Tasks 2, 4, 5, 6, 7.
