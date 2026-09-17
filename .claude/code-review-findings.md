# slimRDM Code Review Findings
_Generated 2026-05-20. Work through these top-to-bottom by severity._

---

## Critical

- [x] **SSH host key verification disabled (MITM)** ✓ fixed 2026-05-20
  - Files: `src-tauri/src/commands/ssh.rs:139–144`, `src-tauri/src/commands/tunnel_utils.rs:34–41`
  - `ClientHandler::check_server_key` and `NoopHandler::check_server_key` unconditionally return `Ok(true)`. Every SSH and jump host connection is vulnerable to MITM.
  - Fix: Implement known-hosts fingerprint storage. On first connect, store the fingerprint. On subsequent connects, compare and warn if changed.

---

## High

- [x] **Passwords sent over Tauri IPC (visible in DevTools)** ✓ fixed 2026-05-20
  - Files: `src-tauri/src/commands/ssh.rs:26–40`, `src/hooks/useSshTerminal.ts:214–227`, `src/utils/tauri.ts:6–27`
  - `SshConnectParams.password` and `JumpHostParams.password` flow frontend → IPC → Rust. Accessible via Chromium DevTools in the webview process.
  - Fix: Remove passwords from IPC. Backend fetches credentials directly from keyring given the `credentialRef`. Frontend only sends `credentialRef`.

- [x] **`download_and_install_update` executes arbitrary URLs** ✓ fixed 2026-05-20
  - File: `src-tauri/src/commands/updates.rs:61–85`
  - Accepts any `url: String` from the frontend, downloads, and executes it with no domain validation.
  - Fix: Validate URL starts with `https://github.com/GnomishGames/slimRDM/releases/download/` before downloading.

- [x] **Credential ref collision overwrites keyring passwords** ✓ fixed 2026-05-20
  - File: `src/components/modals/AddConnectionModal.tsx:86`
  - Key format `host:port:username` means two connections to the same host+user silently overwrite each other's password.
  - Fix: Use connection `id` in the key (e.g. `conn:${id}`).

- [x] **CSP disabled** ✓ fixed 2026-05-20
  - File: `src-tauri/tauri.conf.json:29`
  - `"csp": null` — any injected JS can call all Tauri commands including `save_credential` and `download_and_install_update`.
  - Fix: Set `"csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;"`.

- [x] **Global RDP clipboard state breaks with multiple RDP sessions** ✓ fixed 2026-05-20
  - File: `src-tauri/src/commands/clipboard.rs:20–26`
  - `RDP_FORMAT_LIST_PENDING`, `RDP_INITIATE_PASTE`, `RDP_REQUESTED_FORMAT` are single globals. Two concurrent RDP sessions corrupt each other's clipboard state.
  - Fix: Key all clipboard globals by `session_id` using a `HashMap`, or move state into per-session structs with `mpsc` channels.

- [x] **Deleting a connection doesn't clean up its keyring credential** ✓ fixed 2026-05-20
  - File: `src/components/sidebar/Sidebar.tsx:66–70`
  - `deleteConnection` is called without a prior `credentials.delete(conn.credentialRef)`. Passwords accumulate in the OS keyring indefinitely.
  - Fix: Before calling `deleteConnection`, call `if (conn.credentialRef) await credentials.delete(conn.credentialRef).catch(() => {})`.

---

## Medium

- [ ] **`load_store`/`save_store` not serialized — concurrent mutations lose data**
  - File: `src-tauri/src/commands/connections.rs:9–26`
  - All write commands follow non-atomic read-modify-write across `await` points. Concurrent commands (e.g. add + update) can result in last-write-wins data loss.
  - Fix: Wrap store in a `tokio::sync::Mutex` so writes are serialized.

- [ ] **`resolveCredentials` and `JumpHostParams` duplicated between hooks**
  - Files: `src/hooks/useSshTerminal.ts:19–47`, `src/hooks/useRdpCanvas.ts:72–95`
  - Both define identical `JumpHostParams` type and near-identical `resolveCredentials` / `resolveJumpHostParams` functions.
  - Fix: Extract to `src/utils/credentials.ts`, import in both hooks and `tauri.ts`.

- [ ] **Auto-reconnect can stack multiple timers**
  - File: `src/hooks/useSshTerminal.ts:131–160`
  - On rapid disconnect events, a second reconnect timer can be scheduled before the first fires.
  - Fix: Add `if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);` at the top of the disconnect handler before scheduling a new timer.

- [ ] **`closeSession` doesn't disconnect backend — zombie sessions on reconnect**
  - File: `src/store/appStore.ts:123–133`, `src/components/sidebar/Sidebar.tsx:240–244`
  - `handleReconnect` calls `closeSession` (store only) then immediately opens a new session. The cleanup `useEffect` fires asynchronously, leaving a potential zombie backend session.
  - Fix: Explicitly call `ssh.disconnect(session.id)` / `rdp.disconnect(session.id)` before `closeSession` in the reconnect handler.

- [ ] **Credential deleted before `updateConnection` succeeds**
  - File: `src/components/modals/AddConnectionModal.tsx:92–95`
  - When changing auth type, old credential is deleted before `updateConnection` returns. On backend failure, credential is gone but connection still references old auth type.
  - Fix: Delete old credential only after `updateConnection` resolves successfully.

- [ ] **RDP frame Base64 encoding large pixel buffers in hot loop**
  - File: `src-tauri/src/commands/rdp.rs:399`
  - Full-screen 1920×1080 frames produce ~8MB RGBA, Base64'd to ~10.7MB per IPC event at up to 60fps.
  - Fix: Use Tauri v2 typed `Channel` API or shared memory. Stop Base64-encoding pixel data.

- [ ] **`parent_id` on `Group` is vestigial — never settable or used**
  - Files: `src-tauri/src/store.rs:86–105`, `src-tauri/src/commands/groups.rs:31–46`
  - `Group.parent_id` exists in the persistent store but is never set by the UI or any command.
  - Fix: Remove `parent_id` from `Group` and store, or implement nested groups properly.

- [ ] **All sessions receive all events — O(n) filtering**
  - Files: `src/hooks/useSshTerminal.ts:119`, `src/hooks/useRdpCanvas.ts:177`
  - Every open session registers a global listener for `ssh-output`, `rdp-frame`, etc. With n sessions, every event fires n listeners.
  - Fix: Use Tauri v2 per-session event channels (`emit_to` with a channel target).

---

## Low

- [ ] **`NumLock` and `Pause` share scancode 0x45**
  - File: `src/hooks/useRdpCanvas.ts:61`
  - `Pause` needs a 3-byte `E1 1D 45` sequence. Sending 0x45 will toggle NumLock instead.
  - Fix: Remove `Pause` from the map or handle it as a special-case multi-byte sequence.

- [ ] **Double keyring fetch in `SshPanel`**
  - Files: `src/components/session/SessionPanel.tsx:37–43`, `src/hooks/useSshTerminal.ts:212–220`
  - `SshPanel.init()` fetches the password, passes it to `connect(password)`. Inside `connect`, `resolveCredentials` fetches it again. The outer fetch is redundant.
  - Fix: Remove credential fetch from `SshPanel.init()`. Let `resolveCredentials` in the hook handle it entirely.

- [ ] **`sidebarWidth` state never read or persisted**
  - File: `src/store/appStore.ts:15, 43`
  - Defined in app state, never used in any component. Leftover scaffolding.
  - Fix: Implement resizable sidebar or remove the field.

- [ ] **`store::init` is a no-op**
  - File: `src-tauri/src/store.rs:107–110`
  - Function body is empty, just `Ok(())`. Called in `lib.rs:15`.
  - Fix: Remove the function and the call site.

- [ ] **`tauri_plugin_notification` registered but never used**
  - File: `src-tauri/src/lib.rs:11`
  - Plugin initialized and permitted but no code calls any notification API.
  - Fix: Remove `.plugin(tauri_plugin_notification::init())` and the `notification:default` capability entry.

- [ ] **Settings save errors silently dropped**
  - File: `src/store/settingsStore.ts:92–98`
  - Every setter calls `s.save()` with no `.catch()`. Disk-full or permission errors silently lose settings.
  - Fix: Add `.catch(console.error)` or a user-facing toast.

- [ ] **No opt-out for automatic update checks**
  - File: `src/App.tsx:24–29`
  - Update check runs on every startup, contacting GitHub API with no user control.
  - Fix: Add "Check for updates automatically" toggle in settings (default on).

- [ ] **Session ID leaks connection UUID and timestamp**
  - File: `src/store/appStore.ts:109`
  - Format `${connection.id}-${Date.now()}` embeds the connection UUID in every IPC event.
  - Fix: Use `crypto.randomUUID()` for session IDs.

- [ ] **`image` crate may be an unused dependency**
  - File: `src-tauri/Cargo.toml`
  - `image` is listed but not imported in any `.rs` file. Verify with `cargo tree`.
  - Fix: Remove if unused.
