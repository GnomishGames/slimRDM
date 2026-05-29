# TODO

Items are loosely ordered by priority. Move finished items to CHANGELOG.md when shipped.

---

## Features

- [ ] **RDP tab support** — RDP connections currently open externally; embed them as tabs like SSH/TRM
- [ ] **SSH key authentication** — support `~/.ssh/id_*` key files and per-connection key selection in the edit modal
- [ ] **Session logging** — option to write terminal output to a timestamped log file per connection
- [ ] **Connection search / quick-connect** — keyboard-accessible fuzzy search over all connections (Ctrl+K or similar)
- [ ] **SSH tunnels UI** — expose the existing `tunnel_utils.rs` infrastructure as a manageable list in the sidebar
- [ ] **Group-level startup commands** — inherit startup commands from the group so connections don't each need them set
- [ ] **Connection notes / description field** — freeform text attached to a connection, visible in a tooltip or detail pane
- [ ] **Import / export** — `slimrdm.json` round-trip import, plus import from common formats (CSV, PuTTY sessions)
- [ ] **Split view beyond 3 panes** — currently capped at 3; evaluate demand for 4+

## UX / Polish

- [ ] **Drag-and-drop reordering** — reorder connections and groups within the sidebar by dragging
- [ ] **Tab rename** — double-click a tab label to give the session a custom name
- [ ] **Reconnect button** — show a reconnect prompt in the tab when an SSH connection drops (EOF) instead of just closing
- [ ] **Sidebar resize** — draggable divider between sidebar and terminal area
- [ ] **Dark/light theme toggle** — user-selectable theme; currently hardcoded dark
- [ ] **Connection status indicators** — colored dot on sidebar items showing connected / disconnected / error

## Bugs / Known Issues

- [ ] **xterm.js fit on split resize** — rapidly dragging the split handle can leave a terminal sized incorrectly until the window is resized
- [ ] **Windows: credential store fallback** — keyring calls on Windows can silently fail when no wallet is unlocked; surface a clear error
- [ ] **Jump host + RDP** — ProxyJump routing is wired for SSH; RDP connections ignore the jump host field

## Tech Debt

- [ ] Consolidate `NewConnection` / `Connection` types — frontend duplicates field definitions; generate from a shared source
- [ ] Add integration tests for Rust SSH/TRM command handlers
- [ ] Audit `default.json` capabilities — remove any overly broad permissions granted during early development
- [ ] Replace ad-hoc `console.error` calls in React with a structured error boundary + toast system
