import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

export const ssh = {
  connect: (params: {
    sessionId: string;
    host: string;
    port: number;
    username: string;
    authType: string;
    password?: string;
    privateKeyPath?: string;
    privateKeyPassphrase?: string;
    keepaliveInterval?: number;
    connectTimeout?: number;
    initialCols?: number;
    initialRows?: number;
  }) => invoke("ssh_connect", { params }),

  sendInput: (sessionId: string, data: string) =>
    invoke("ssh_send_input", { sessionId, data }),

  resize: (sessionId: string, cols: number, rows: number) =>
    invoke("ssh_resize", { sessionId, cols, rows }),

  disconnect: (sessionId: string) =>
    invoke("ssh_disconnect", { sessionId }),
};

export const rdp = {
  connect: (params: {
    sessionId: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    domain?: string;
    width?: number;
    height?: number;
    performanceFlags?: {
      disableWallpaper: boolean;
      disableFontSmoothing: boolean;
      disableAnimation: boolean;
      disableTheme: boolean;
      disableMenuAnimations: boolean;
      disableCursorShadow: boolean;
      disableCursorBlinking: boolean;
      enableDesktopComposition: boolean;
    };
    connectionQuality?: string;
  }) => invoke("rdp_connect", { params }),

  disconnect: (sessionId: string) =>
    invoke("rdp_disconnect", { sessionId }),

  mouseEvent: (sessionId: string, flags: number, x: number, y: number, wheelUnits: number) =>
    invoke("rdp_mouse_event", { sessionId, flags, x, y, wheelUnits }),

  keyEvent: (sessionId: string, flags: number, scancode: number) =>
    invoke("rdp_key_event", { sessionId, flags, scancode }),

  resize: (sessionId: string, width: number, height: number) =>
    invoke("rdp_resize", { sessionId, width, height }),
};

export const dialog = {
  pickFile: (title: string) =>
    openDialog({ title, multiple: false, directory: false }),

  saveFile: (title: string, defaultPath?: string) =>
    saveDialog({ title, defaultPath }),
};

export const data = {
  export: (path: string) =>
    invoke("export_data", { path }),

  import: (path: string, replace: boolean) =>
    invoke<{ connectionsAdded: number; groupsAdded: number }>("import_data", { path, replace }),
};

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string | null;
  releaseNotes: string | null;
}

export const updates = {
  check: () => invoke<UpdateInfo>("check_for_updates"),
};

export const credentials = {
  save: (refKey: string, password: string) =>
    invoke("save_credential", { refKey, password }),

  get: (refKey: string) =>
    invoke<string>("get_credential", { refKey }),

  delete: (refKey: string) =>
    invoke("delete_credential", { refKey }),
};

export const clipboard = {
  getSystem: () => invoke<string>("clipboard_get_system"),
  setSystem: (text: string) => invoke("clipboard_set_system", { text }),
  getRdp: (sessionId: string) => invoke<number[] | null>("clipboard_get_rdp", { sessionId }),
  setRdp: (sessionId: string, data: number[]) => invoke("clipboard_set_rdp", { sessionId, data }),
};
