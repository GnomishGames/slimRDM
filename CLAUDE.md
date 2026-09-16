# SlimRDM

Tauri 2 (Rust) + React 18 / TypeScript SSH/RDP connection manager.

## Dev
```bash
npm run tauri dev
```

## Repo
https://github.com/GnomishGames/slimRDM

## Gotchas

**No React StrictMode** — double-effect behaviour opened SSH connections twice. Do not re-add it.

**NewConnection / NewGroup structs** — Rust backend uses separate input types with no `id`/`created_at`. IDs are generated server-side. Do not send `id` from the frontend when creating.

**Tauri v2 capabilities** — all frontend permissions must be in `src-tauri/capabilities/default.json`. Silent failures → check there first.

**xterm.js live theme updates** — use `useSettingsStore.subscribe()` (imperative, not a React effect). After setting `term.options.theme`, call `term.refresh(0, term.rows - 1)` to force canvas repaint on idle terminals.

**SSH EOF → tab close** — Rust SSH loop uses `tokio::select!` on disconnect channel + `channel_eof` handler. This is what makes `exit` in the shell close the tab.

**Sidebar ordering** — every list the sidebar renders (categories, groups, connections, tunnels) is ordered in `src/utils/ordering.ts` and nowhere else. The Rust `list_*` commands and the appStore mutations deliberately do **not** sort; adding a sort back to either reintroduces the bug where order depended on which code path last touched the array.

**RDP modifier keys** — WebKitGTK with an ibus IM context never delivers a `keydown` for a bare modifier key (only the keyup), so remote modifier state is reconciled from each event's `ctrlKey`/`altKey`/`shiftKey`/`metaKey` flags in `src/utils/rdpKeyboard.ts` — **not** from modifier key events. Driving it from modifier keydowns is the obvious-looking approach and silently reintroduces the bug where Ctrl+C typed a literal "c". Two rules the platform forces: a modifier's own event uses the event type rather than the flag (the Control keyup reports `ctrlKey: true`), and a key release never synthesizes a modifier press.

**RDP remote cursor** — the session runs with `pointer_software_rendering: false`, so the server never paints the cursor into the framebuffer; it ships pointer bitmaps out of band. `ActiveStageOutput::PointerBitmap`/`PointerDefault`/`PointerHidden` must be forwarded to the frontend (`rdp-cursor`) and turned into a CSS cursor on the canvas — planning logic in `src/utils/rdpCursor.ts`. Drop them and every remote shape (resize arrows, I-beam, busy ring) silently disappears, leaving the local arrow. Within one output batch only the **last** pointer state is applied: a cached-pointer change emits `PointerHidden` immediately followed by `PointerBitmap`, and honouring both blinks the cursor off between shapes.

**Credential storage** — passwords go in OS keyring under `host:port:username`, not in `slimrdm.json`. Connection record stores a `credentialRef` string.
