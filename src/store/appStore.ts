import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { Connection, Group, Session, SessionStatus } from "../types";

interface AppState {
  // Data
  connections: Connection[];
  groups: Group[];
  sessions: Session[];
  activeSessionId: string | null;

  // UI
  searchQuery: string;
  selectedGroupId: string | null;
  sidebarWidth: number;

  // Actions
  loadConnections: () => Promise<void>;
  loadGroups: () => Promise<void>;
  addConnection: (conn: Omit<Connection, "id" | "createdAt">) => Promise<Connection>;
  updateConnection: (conn: Connection) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  addGroup: (group: Omit<Group, "id">) => Promise<Group>;
  deleteGroup: (id: string) => Promise<void>;

  openSession: (connection: Connection) => string;
  closeSession: (sessionId: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus, error?: string) => void;
  setActiveSession: (sessionId: string | null) => void;

  setSearchQuery: (q: string) => void;
  setSelectedGroup: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  connections: [],
  groups: [],
  sessions: [],
  activeSessionId: null,
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

  addConnection: async (conn) => {
    const added = await invoke<Connection>("add_connection", { connection: conn });
    set((s) => ({ connections: [...s.connections, added] }));
    return added;
  },

  updateConnection: async (conn) => {
    const updated = await invoke<Connection>("update_connection", { connection: conn });
    set((s) => ({
      connections: s.connections.map((c) => (c.id === updated.id ? updated : c)),
    }));
  },

  deleteConnection: async (id) => {
    await invoke("delete_connection", { id });
    set((s) => ({ connections: s.connections.filter((c) => c.id !== id) }));
  },

  addGroup: async (group) => {
    const added = await invoke<Group>("add_group", { group });
    set((s) => ({ groups: [...s.groups, added] }));
    return added;
  },

  deleteGroup: async (id) => {
    await invoke("delete_group", { id });
    set((s) => ({ groups: s.groups.filter((g) => g.id !== id) }));
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
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: sessionId,
    }));
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
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedGroup: (id) => set({ selectedGroupId: id }),
}));
