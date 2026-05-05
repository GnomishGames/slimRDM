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
  }) => invoke("rdp_connect", { params }),

  disconnect: (sessionId: string) =>
    invoke("rdp_disconnect", { sessionId }),

  mouseEvent: (sessionId: string, flags: number, x: number, y: number) =>
    invoke("rdp_mouse_event", { sessionId, flags, x, y }),

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

export const credentials = {
  save: (refKey: string, password: string) =>
    invoke("save_credential", { refKey, password }),

  get: (refKey: string) =>
    invoke<string>("get_credential", { refKey }),

  delete: (refKey: string) =>
    invoke("delete_credential", { refKey }),
};
