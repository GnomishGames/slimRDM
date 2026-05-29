# TODO

Items are loosely ordered by priority. Move finished items to CHANGELOG.md when shipped.

---

## Features

- [ ] **Session logging** — option to write terminal output to a timestamped log file per connection
- [ ] **SSH tunnels UI** — expose the existing `tunnel_utils.rs` infrastructure as a manageable list in the sidebar
- [ ] **Group-level startup commands** — inherit startup commands from the group so connections don't each need them set (Connection has the field; Group does not)
- [ ] **Import / export** — `slimrdm.json` round-trip import, plus import from common formats (CSV, PuTTY sessions)
- [ ] **Split view beyond 3 panes** — currently capped at 3; evaluate demand for 4+

## UX / Polish

- [ ] **Drag-and-drop reordering** — reorder connections and groups within the sidebar by dragging
- [ ] **Tab rename** — double-click a tab label to give the session a custom name
- [ ] **Sidebar resize** — draggable divider between sidebar and terminal area (`sidebarWidth` is in the store but never wired to a drag handle in the UI)

## Bugs / Known Issues

- [ ] **xterm.js fit on split resize** — rapidly dragging the split handle can leave a terminal sized incorrectly until the window is resized
- [ ] **Windows: credential store fallback** — keyring calls on Windows can silently fail when no wallet is unlocked; surface a clear error
- [ ] **Jump host + RDP** — ProxyJump routing is wired for SSH; RDP connections ignore the jump host field

## Tech Debt

- [ ] Consolidate `NewConnection` / `Connection` types — frontend duplicates field definitions; generate from a shared source
- [ ] Add integration tests for Rust SSH/TRM command handlers
- [ ] Audit `default.json` capabilities — remove any overly broad permissions granted during early development
- [ ] Replace ad-hoc `console.error` calls in React with a structured error boundary + toast system

---

## Already Implemented (removed from above)

- **RDP tab support** — RDP renders as an embedded canvas tab via `useRdpCanvas`
- **SSH key authentication** — `privateKeyPath` field + "Key path" UI in the connection modal
- **Connection search** — sidebar search bar; press `/` to focus it
- **Connection notes** — `notes` field in types and connection modal
- **Reconnect** — `autoReconnect` global setting + reconnect button in sidebar + auto-retry timer in `useSshTerminal`
- **Dark/light theme** — multiple light themes (GitHub Light, Solarized Light, Monokai Light) in Settings → App Theme
- **Connection status indicators** — icon on each sidebar item changes color for connected / connecting / error states
