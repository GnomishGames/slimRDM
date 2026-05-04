# SlimRDM

A lightweight, cross-platform RDP & SSH client built with Rust + Tauri + React.

## Stack

- **Backend**: Rust (Tauri 2)
- **Frontend**: React 18 + TypeScript
- **SSH**: `russh` crate
- **RDP**: Native client delegation (mstsc on Windows, xfreerdp on Linux/Mac)
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
# For RDP:
sudo apt install freerdp2-x11
```

### macOS
```bash
xcode-select --install
# For RDP:
brew install freerdp
```

### Windows
- Visual Studio Build Tools with C++ workload
- RDP via built-in `mstsc` (no extra install needed)

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
│   │   └── session/            # Tab bar, terminal panel, RDP panel
│   ├── hooks/
│   │   └── useSshTerminal.ts   # xterm.js + Tauri event bridge
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
        │   ├── rdp.rs          # RDP process launcher
        │   └── credentials.rs  # OS keyring integration
        ├── session.rs          # Session state types
        ├── store.rs            # Serializable data types
        └── lib.rs              # Tauri app setup
```

## Roadmap

- [ ] Add/Edit connection modal with full form validation
- [ ] SSH key file picker
- [ ] SSH agent forwarding
- [ ] Embedded RDP via ironrdp (replace external client)
- [ ] Session reconnect on disconnect
- [ ] Tabbed terminal multiplexing (split panes)
- [ ] Connection import (CSV, RDM format)
- [ ] Vault encryption for credential store
- [ ] Theming support
