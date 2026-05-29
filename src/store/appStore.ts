import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { Category, Connection, Group, Session, SessionStatus } from "../types";
import { useSettingsStore } from "./settingsStore";

interface AppState {
  // Data
  connections: Connection[];
  groups: Group[];
  categories: Category[];
  sessions: Session[];
  activeSessionId: string | null;
  splitSessionIds: string[];

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

  openSession: (connection: Connection) => string;
  closeSession: (sessionId: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus, error?: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  setSplitSessions: (ids: string[]) => void;

  setSearchQuery: (q: string) => void;
  setSelectedGroup: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  connections: [],
  groups: [],
  categories: [],
  sessions: [],
  activeSessionId: null,
  splitSessionIds: [],
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

  openSession: (connection) => {
    const sessionId = `${connection.id}-${Date.now()}`;
    const session: Session = {
      id: sessionId,
      connectionId: connection.id,
      connection,
      status: "connecting",
      openedAt: Date.now(),
    };
    set((s) => {
      const { behavior } = useSettingsStore.getState();
      const splitSessionIds =
        behavior.splitView && s.splitSessionIds.length < 3
          ? [...s.splitSessionIds, sessionId]
          : s.splitSessionIds;
      return { sessions: [...s.sessions, session], activeSessionId: sessionId, splitSessionIds };
    });
    return sessionId;
  },

  closeSession: (sessionId) => {
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== sessionId);
      const activeSessionId =
        s.activeSessionId === sessionId
          ? sessions[sessions.length - 1]?.id ?? null
          : s.activeSessionId;
      const splitSessionIds = s.splitSessionIds.filter((id) => id !== sessionId);
      return { sessions, activeSessionId, splitSessionIds };
    });
  },

  setSessionStatus: (sessionId, status, error) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status, error } : sess
      ),
    }));
  },

  setActiveSession: (sessionId) => {
    set((s) => {
      if (sessionId === null) return { activeSessionId: null };
      const { behavior } = useSettingsStore.getState();
      if (!behavior.splitView) return { activeSessionId: sessionId };

      const { splitSessionIds } = s;
      if (splitSessionIds.includes(sessionId)) {
        // Already visible in split — just focus it
        return { activeSessionId: sessionId };
      }
      if (splitSessionIds.length < 3) {
        // Room for one more pane
        return { activeSessionId: sessionId, splitSessionIds: [...splitSessionIds, sessionId] };
      }
      // Replace the currently focused pane
      const activeIdx = splitSessionIds.indexOf(s.activeSessionId ?? "");
      const newSplit = [...splitSessionIds];
      newSplit[activeIdx >= 0 ? activeIdx : splitSessionIds.length - 1] = sessionId;
      return { activeSessionId: sessionId, splitSessionIds: newSplit };
    });
  },

  setSplitSessions: (ids) => set({ splitSessionIds: ids }),

  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedGroup: (id) => set({ selectedGroupId: id }),
}));
