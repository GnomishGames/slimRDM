import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

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
    fullscreen?: boolean;
  }) => invoke("rdp_connect", { params }),

  disconnect: (sessionId: string) =>
    invoke("rdp_disconnect", { sessionId }),
};

export const dialog = {
  pickFile: (title: string) =>
    openDialog({ title, multiple: false, directory: false }),
};

export const credentials = {
  save: (refKey: string, password: string) =>
    invoke("save_credential", { refKey, password }),

  get: (refKey: string) =>
    invoke<string>("get_credential", { refKey }),

  delete: (refKey: string) =>
    invoke("delete_credential", { refKey }),
};
