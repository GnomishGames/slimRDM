# SlimRDM

A lightweight, cross-platform RDP & SSH client built with Rust + Tauri + React.

## Stack

- **Backend**: Rust (Tauri 2)
- **Frontend**: React 18 + TypeScript
- **SSH**: `russh` crate
- **RDP**: `ironrdp` — pure-Rust RDP protocol, renders directly to canvas (no xfreerdp/mstsc required, Wayland-compatible)
- **Terminal emulator**: xterm.js
- **Credential storage**: OS keyring (Keychain / Windows Credential Manager / libsecret)
- **Persistence**: `tauri-plugin-store` (JSON file, app data dir)

## Prerequisites

### All platforms
- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) >= 18

### Linux
```bash
sudo apt install libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### macOS
```bash
xcode-select --install
```

### Windows
- Visual Studio Build Tools with C++ workload

## Development

```bash
# Install JS dependencies
npm install

# Run in dev mode (hot reload)
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Output binaries in `src-tauri/target/release/bundle/`.

## Project Structure

```
slimrdm/
├── src/                        # React frontend
│   ├── components/
│   │   ├── sidebar/            # Connection list, search, groups
│   │   └── session/            # Tab bar, SSH terminal, RDP canvas
│   ├── hooks/
│   │   ├── useSshTerminal.ts   # xterm.js + Tauri event bridge
│   │   └── useRdpCanvas.ts     # Canvas renderer + input forwarding
│   ├── store/
│   │   └── appStore.ts         # Zustand global state
│   ├── types/index.ts          # TypeScript types
│   └── utils/tauri.ts          # invoke() wrappers
└── src-tauri/                  # Rust backend
    └── src/
        ├── commands/
        │   ├── connections.rs  # CRUD for saved connections
        │   ├── groups.rs       # Connection groups
        │   ├── ssh.rs          # SSH session management
        │   ├── rdp.rs          # RDP session (ironrdp, NLA/CredSSP)
        │   ├── credentials.rs  # OS keyring integration
        │   ├── data.rs         # Import/export
        │   └── updates.rs      # GitHub release update checker
        ├── store.rs            # Serializable data types
        └── lib.rs              # Tauri app setup
```

## Roadmap

- [x] SSH connections (password, public key, agent)
- [x] Embedded RDP via ironrdp (NLA/CredSSP, Wayland-compatible)
- [x] Connection groups, search, themes
- [x] SSH defaults (port, keepalive, timeout)
- [x] Behavior settings (copy-on-select, confirm-close, auto-reconnect)
- [x] Connection import/export (JSON)
- [x] Session auto-reconnect on disconnect
- [x] In-app update checker (Settings → About)
- [ ] Split-pane terminal multiplexing
- [ ] Vault encryption for credential store
