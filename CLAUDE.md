# SlimRDM — Claude Code Context

## What this is
A lightweight SSH/RDP connection manager built with **Tauri 2** (Rust backend) + **React 18 / TypeScript** (frontend). Think a minimal alternative to tools like Royal TSX or mRemoteNG.

## How to run (dev)
```bash
source ~/.cargo/env && npm run tauri dev
```
The window opens automatically. Vite hot-reloads frontend changes; Rust changes trigger a recompile.

## How to run (built binary)
```bash
npm run tauri build
# binary at: src-tauri/target/release/slimrdm
```

## Architecture

### Frontend (`src/`)
| Path | Purpose |
|------|---------|
| `src/App.tsx` | Root layout; loads connections, groups, settings on mount |
| `src/store/appStore.ts` | Zustand store — connections, groups, sessions, active session |
| `src/store/settingsStore.ts` | Zustand store — terminal settings + app theme; persists to `settings.json` |
| `src/hooks/useSshTerminal.ts` | xterm.js lifecycle, SSH event listeners, settings subscription |
| `src/components/sidebar/Sidebar.tsx` | Connection list, groups, search, settings gear |
| `src/components/modals/AddConnectionModal.tsx` | Add/edit connection form |
| `src/components/modals/SettingsModal.tsx` | Appearance settings (app theme + terminal) |
| `src/components/session/SessionPanel.tsx` | SSH terminal panel (xterm.js) + RDP status panel |
| `src/utils/terminalThemes.ts` | xterm.js color themes + font family list |
| `src/utils/appThemes.ts` | App-wide CSS variable themes (swapped on `<html>`) |
| `src/utils/tauri.ts` | Typed wrappers for all Tauri invoke calls |

### Backend (`src-tauri/src/`)
| Path | Purpose |
|------|---------|
| `commands/connections.rs` | CRUD for connections; persists to `slimrdm.json` via tauri-plugin-store |
| `commands/groups.rs` | CRUD for groups |
| `commands/ssh.rs` | SSH connect/disconnect/input/resize via `russh` crate; streams output as Tauri events |
| `commands/rdp.rs` | RDP — launches system xfreerdp/mstsc as a child process |
| `commands/credentials.rs` | Passwords stored in OS keyring via `keyring` crate |
| `store.rs` | Serde structs: `Connection`, `Group`, `AppStore`, `NewConnection`, `NewGroup` |
| `session.rs` | In-memory session registry (Arc<Mutex<HashMap>>) |

### Key plugins (Tauri v2)
- `tauri-plugin-store` — JSON file persistence for connections/groups and settings
- `tauri-plugin-dialog` — native file picker (SSH key selection)
- `tauri-plugin-window-state` — saves/restores window size + position
- `tauri-plugin-shell` — shell access for RDP launch

## Features implemented
- [x] SSH connections with password / public key / SSH agent auth
- [x] xterm.js terminal with fit addon, web links, resize
- [x] Tab auto-close when SSH session exits
- [x] Connection groups (folders) with expand/collapse
- [x] Connection editing (right-click > Edit)
- [x] SSH key file browser (native dialog)
- [x] Auth-type icons in sidebar (red lock / yellow key / blue CPU)
- [x] Status-colored sidebar icons (grey=idle, yellow=connecting, green=connected, red=error)
- [x] Window title: `[SlimRDM]`
- [x] Window size + position persistence
- [x] App-wide themes (GitHub Dark, Midnight, Dracula, Nord, Catppuccin, One Dark)
- [x] Terminal color schemes (same 6 themes, separate from app theme)
- [x] Terminal font family, font size, scrollback, cursor style, cursor blink

## Settings panel — todos remaining
- [ ] SSH defaults (default username, port, keepalive, timeout)
- [ ] Behavior (copy-on-select, confirm-close-tab, auto-reconnect)
- [ ] Data (export/import connections as JSON)
- [ ] About (version, repo link)

## Important gotchas / decisions

**No React StrictMode** — removed because StrictMode's double-effect behaviour opened SSH connections twice. Do not re-add it.

**NewConnection / NewGroup structs** — The Rust backend uses separate `NewConnection` / `NewGroup` input types (no `id`, no `created_at`). IDs are generated server-side with `uuid::Uuid::new_v4()`. Do not send `id` from the frontend when creating.

**Tauri v2 capabilities** — All frontend permissions must be listed in `src-tauri/capabilities/default.json`. If a Tauri API call silently fails, check permissions there first.

**xterm.js live theme updates** — Use `useSettingsStore.subscribe()` (zustand's imperative subscribe, not a React effect) to push option changes to the terminal. After setting `term.options.theme`, call `term.refresh(0, term.rows - 1)` to force a canvas repaint — idle terminals won't redraw otherwise.

**SSH EOF → tab close** — The Rust SSH loop uses `tokio::select!` on both a frontend disconnect channel and a server EOF channel (`channel_eof` handler). This is what makes `exit` in the shell close the tab.

**Credential storage** — Passwords are NOT stored in `slimrdm.json`. They go in the OS keyring under a key of `host:port:username`. The connection record only stores a `credentialRef` string pointing to the keyring key.

## Repo
https://github.com/GnomishGames/slimRDM
