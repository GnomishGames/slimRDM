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

**Legacy TLS fallback** — some Windows hosts offer only CBC cipher suites and a
SHA-1 signed RDP certificate, which rustls cannot negotiate at all, so the server
resets the socket mid-handshake (`TLS upgrade failed: Connection reset by peer`).
A refused handshake is retried once over OpenSSL in `src-tauri/src/commands/legacy_tls.rs`.
`set_security_level(0)` is load-bearing for a non-obvious reason: it is what makes
OpenSSL advertise `rsa_pkcs1_sha1`, without which a server whose only certificate
is SHA-1 signed has nothing it can present. CBC suites themselves are fine at
level 2, so "we only need old ciphers" is the wrong mental model. The cipher list
deliberately excludes the broken families — forcing this path costs an attacker
only a TCP reset.

**Graphics pipeline (EGFX)** — hosts running the WDDM RDP display driver paint
*only* through `Microsoft::Windows::RDS::Graphics`. They still advertise the
legacy bitmap codecs but never produce them, so a client without the channel gets
a healthy, logged-on session (clipboard and all) on a permanently blank canvas.
ironrdp defines `SUPPORT_DYN_VC_GFX_PROTOCOL` but never sets it, which is the only
reason `vendor/ironrdp-connector` exists. EGFX surfaces are blitted into their own
framebuffer in `commands/egfx.rs` because `DecodedImage` exposes no mutable data.

**Server Deactivate All** — sent when a client reconnects to an existing session.
Until the client reruns the capability exchange the server sends no graphics,
which looks exactly like the EGFX blank screen. `ActiveStageOutput::DeactivateAll`
must never fall into a catch-all arm.

**Credential storage** — passwords go in OS keyring under `host:port:username`, not in `slimrdm.json`. Connection record stores a `credentialRef` string.
