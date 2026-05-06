# SlimRDM

Tauri 2 (Rust) + React 18 / TypeScript SSH/RDP connection manager.

## Dev
```bash
source ~/.cargo/env && npm run tauri dev
```

## Repo
https://github.com/GnomishGames/slimRDM

## Gotchas

**No React StrictMode** — double-effect behaviour opened SSH connections twice. Do not re-add it.

**NewConnection / NewGroup structs** — Rust backend uses separate input types with no `id`/`created_at`. IDs are generated server-side. Do not send `id` from the frontend when creating.

**Tauri v2 capabilities** — all frontend permissions must be in `src-tauri/capabilities/default.json`. Silent failures → check there first.

**xterm.js live theme updates** — use `useSettingsStore.subscribe()` (imperative, not a React effect). After setting `term.options.theme`, call `term.refresh(0, term.rows - 1)` to force canvas repaint on idle terminals.

**SSH EOF → tab close** — Rust SSH loop uses `tokio::select!` on disconnect channel + `channel_eof` handler. This is what makes `exit` in the shell close the tab.

**Credential storage** — passwords go in OS keyring under `host:port:username`, not in `slimrdm.json`. Connection record stores a `credentialRef` string.
