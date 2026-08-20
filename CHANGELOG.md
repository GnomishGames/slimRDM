# Changelog

## [1.7.8] - 2026-08-19

### Security
- **Self-update signatures are live** — 1.7.7 shipped the Minisign verification code, but no signing key had ever been configured in CI, so no release carried a `.sig` and the in-app updater fell back to *View Release* for every update. Release installers are now signed during the build and publish a matching `.sig` alongside them, so updates are verified against the embedded public key before anything is written to disk.
- **Update signing key rotated** — the embedded public key was a placeholder generated while developing the feature. It has been replaced with a key held by the project maintainer, whose private half exists only in their password manager and as a GitHub Actions secret. Because 1.7.7 is the only build carrying the placeholder key, it cannot verify 1.7.8 and has been withdrawn; install 1.7.8 directly. Releases 1.7.6 and earlier have no update verification and upgrade normally.
- **Release checksums are published** — the updater has always looked for a `<installer>.sha256` sidecar to check a download against, but the release workflow never produced one, so that check was dead code on every release. CI now writes and publishes a checksum beside each installer, which also gives manual downloads something to verify with `sha256sum -c`. It sits behind the signature rather than beside it: the sidecar is unsigned, so a malformed one is treated as “no checksum” instead of a mismatch that would block an otherwise valid update.

## [1.7.7] - 2026-08-19

### Fixed
- **Sidebar order no longer changes between launches** — categories, groups, connections and tunnels were ordered in three different places at once (the backend on load, the frontend after an edit, and nowhere at all for categories), so the list appeared in creation order at launch and snapped to alphabetical the moment any group was added or edited. Ordering now happens in one place, is case-insensitive and number-aware (`T2` before `T10`, `t5` alongside `T5`), and no longer depends on the machine's locale.
- **Groups and connections no longer disappear when their category or group is deleted** — a group whose category no longer existed was filtered out of its category section *and* out of the top level, leaving it invisible with no way to reach it. Orphans now fall back to the top level.
- **Backups include categories and tunnels** — exports carried only connections and groups, so importing a backup on another machine left every categorised group invisible, and importing with **Replace** silently erased all saved tunnels. The export format is now version 2; version 1 backups still import.
- **Import and export summaries report real numbers** — the import result was serialised with the wrong key style, so every import reported *"Imported undefined connection(s) and undefined group(s)."* Both messages now list connections, groups, categories and tunnels, and the sidebar's tunnel list refreshes after an import instead of showing entries that are no longer on disk.
- **Group and category pickers are alphabetical** — the group dropdown had the same launch-order/edit-order flip as the sidebar, and the category dropdown was never sorted at all.

### Security
- **Self-updates now require a verified signature** — the in-app updater downloaded and ran an installer with no integrity check, so a compromised GitHub release could have delivered arbitrary executable code (audit finding, High). Updates now require a detached Minisign signature, verified against an embedded public key before the installer is written to disk; where no signature is published, the app links to the releases page instead of offering an in-app install. Every release installer is signed in CI and its `.sig` published alongside it.
- **postcss path traversal advisory (GHSA-r28c-9q8g-f849, high)** resolved — `postcss` and `nanoid` bumped transitively.
- **nanoid infinite-loop advisory (GHSA-2v37-7h3g-55p8, high)** resolved — `nanoid` bumped to 3.3.18 via `postcss`.
- **h2 unbounded empty DATA frames (RUSTSEC-2026-0258)** resolved — `h2` bumped to 0.4.16, transitively via `reqwest`/`hyper`.

### Internal
- CI now enforces mandatory gates on every push: `cargo test`, `cargo clippy -D warnings`, `cargo audit`, `tsc --noEmit`, `npm audit`, and frontend unit tests (vitest, `npm test`).
- Clippy lints cleared across the Rust source ahead of the `-D warnings` gate.
- CI installs system dependencies with a per-attempt timeout and up to three retries, and every job now has a `timeout-minutes` cap — a hung apt mirror previously stalled a release build for over half an hour instead of failing and being re-runnable.
- `docs/signing_steps.md` documents the update-signing key handoff.

## [1.7.6] - 2026-07-18

### Added
- **Terminal renderer is now selectable** — Settings → Appearance offers *WebGL (GPU)* or *DOM (compatible)*. 1.7.3 moved every terminal to the WebGL renderer to fix corruption during full-screen redraws; this makes it a choice, so machines where GPU rendering misbehaves can fall back to the DOM renderer without giving up the fix elsewhere. Defaults to WebGL, and applies to both SSH and local terminals.

## [1.7.5] - 2026-07-10

### Fixed
- **Box-drawing artifacts and stale lines in full-screen TUIs** — following the switch to the WebGL renderer in 1.7.3, terminals still drew stray horizontal line fragments and misaligned box borders in heavy TUI apps (e.g. Claude Code). The cause was a fractional `lineHeight` (1.2), which leaves a dead band between rows that the GPU renderer does not clear on partial redraws. Line height is now 1.0, matching the renderer's cell height to the glyph, so seams line up and no leftover pixels persist.

## [1.7.4] - 2026-07-09

### Security
- **Dependency audit fixes** — `cargo update` resolved the `crossbeam-epoch` and `quick-xml` advisories. Remaining transitive advisories with no available patch (`hickory-proto`, `rsa` / Marvin attack, vendored `russh-cryptovec`, and GTK3 unmaintained-crate warnings) are documented and tracked.

## [1.7.3] - 2026-07-09

### Fixed
- **Terminal rendering corruption during full-screen redraws** — heavy TUI apps (e.g. Claude Code) that continuously repaint the whole screen could leave text jumbled or draw lines on the wrong row, because the terminal was running on xterm.js's DOM renderer, which falls behind under that load. Terminals now use the GPU-accelerated WebGL renderer, which keeps up with rapid full-screen redraws; it falls back to the DOM renderer automatically where WebGL is unavailable.

## [1.7.2] - 2026-07-03

### Fixed
- **Copy-on-select now reliably reaches the system clipboard** — terminal selections were copied via the browser `navigator.clipboard.writeText` API, which Chromium rejects intermittently when the document lacks focus or an active user gesture, so selections often silently failed to copy. Copy-on-select now routes through the OS clipboard (`arboard`) in the Rust backend, matching the RDP clipboard path.

### Added
- **"Copied" confirmation toast** — a brief toast now appears when a terminal selection is copied to the clipboard, so there is visible feedback even at a plain shell prompt (previously the copy was silent).

## [1.7.1] - 2026-07-02

### Fixed
- **Per-connection / per-group "Log Sessions" setting now persists** — the backend store structs were missing the `logSessions` field, so the value was silently dropped on save and the dropdown always reverted to *Inherit*. Existing records without the field load as *Inherit*.

### Added
- **Active session highlighted in the sidebar** — the connection whose session is currently on screen now shows an accent bar in the left-hand list, mirroring the highlight on its tab.

## [1.7.0] - 2026-07-02

### Added
- **Session logging to Obsidian** — SSH session output can be captured to a Markdown vault, with per-connection and per-group logging toggles, a Settings section for the vault path and redaction patterns, and rendered session + daily notes. Orphaned raw capture files are swept on startup.
- **Claude Code session journal** — Claude Code transcripts can be ingested into the same Obsidian vault as session notes with a section-aware daily index, synced incrementally on startup.
- **Sidebar remembers group expand/collapse state** — groups now reopen in the state you left them in, instead of collapsing on every launch.

### Changed
- **Summarizer plugin moved to its own project** — the companion Obsidian summarizer (previously `obsidian-plugin/slimrdm-summarizer`) now lives in a standalone repository, since it is useful beyond slimRDM. It is no longer part of this repo.

## [1.6.2] - 2026-06-28

### Fixed
- **Ctrl+Tab / Ctrl+Shift+Tab tab cycling** — switched to capture-phase keyboard listener so the shortcut works while an xterm terminal is focused.
- **Ctrl+PageUp / Ctrl+PageDown pane cycling** — cycles panes within the current tab (moved from tab-cycling to pane-cycling; Tab shortcuts now handle tab switching).

## [1.5.4] - 2026-06-10

### Fixed
- **SSH — devices requiring "none" auth** — SSH connections to devices that accept the SSH `none` authentication method (e.g. some switches where the account has no local password) now connect automatically. Previously, slimRDM skipped the `none` probe and went straight to password/keyboard-interactive, both of which those devices reject.

### Added
- **Startup commands — credential tokens** — `{username}` and `{password}` in startup commands are now replaced with the connection's stored credentials at connect time. Useful for devices that authenticate at the SSH transport level with `none` but then present a shell-level login prompt (common on some network appliances). Set startup commands to `{username}` and `{password}` on separate lines to auto-fill the prompt.
- **Log rotation** — `slimrdm.log` rotates to `.log.1` at startup if it exceeds 5 MB; `ssh.log` rotates mid-run at 1 MB. At most two files of each type are kept.

---

## [1.5.3] - 2026-06-10

### Fixed
- **SSH — authentication rejected on some Cisco switches** — password auth now works correctly on switches that disconnect the session after rejecting keyboard-interactive. Previously, attempting KI first caused the switch to close the connection before password auth could be tried, resulting in "Authentication rejected by server". The auth order is now password-first with a keyboard-interactive fallback, and russh's inline `USERAUTH_INFO_REQUEST` handler ensures Ubuntu+PAM hosts (which respond to password auth with a challenge prompt) continue to work.

---

## [1.5.2] - 2026-06-10

### Fixed
- **SSH — Cisco switch support** — connections to devices advertising `SSH-1.99` (Cisco CBS350 and similar) now succeed. russh was discarding the `SSH-1.99` version string as a banner line and waiting for `SSH-2.0-`, causing every connection to hang until the 15-second timeout. Patched vendor copy of russh to accept `SSH-1.99` as a valid SSH-2 identifier per RFC 4253 §4.2.
- **SSH — legacy algorithm negotiation** — added `diffie-hellman-group14-sha1`, `diffie-hellman-group1-sha1`, AES-CBC ciphers, and `ssh-rsa` host keys to the preferred algorithm list so older network devices can complete key exchange. Modern servers still negotiate the strongest available algorithm.
- **RDP — font smoothing never applied** — `build_performance_flags` accepted the `disableFontSmoothing` field but never acted on it; `ENABLE_FONT_SMOOTHING` was never sent to the server regardless of the setting. Fixed, and changed the default to have font smoothing **enabled** (ClearType on the remote desktop).
- **RDP — pixelated rendering on HiDPI displays** — RDP session resolution is now requested at physical pixels (`clientWidth × devicePixelRatio`) instead of CSS pixels. The canvas is pinned to its CSS-pixel display size so the browser does not upscale it. Improves sharpness on displays running at fractional or 2× scaling.
- **UI — port not updating when switching connection type in edit modal** — changing SSH → RDP (or any type) in an existing connection now auto-fills the default port for the new type, matching the behaviour in the new-connection modal. Custom ports are preserved if they differ from the previous type's default.

---

## [1.5.1] - 2026-06-02

### Fixed
- **SSH — hang on Ubuntu hosts** — connections to Ubuntu servers with PAM keyboard-interactive auth now complete without hanging. russh's `authenticate_password` silently dropped `SSH_MSG_USERAUTH_INFO_REQUEST` replies and looped forever; switched to `authenticate_keyboard_interactive` with a password fallback.

---

## [1.5.0] - 2026-05-29

### Added
- **SSH tunnel manager** — save and manage SSH tunnels from the sidebar. Each tunnel is configured with an SSH connection (the server to tunnel through), a local port (where you connect on your machine), and a forwarding destination (host:port reachable from the SSH server — use `localhost` for services on the server itself). Tunnels persist across restarts; connect and disconnect them independently without recreating them each session. Right-click a tunnel for Connect / Edit / Delete; the context menu opens upward so it stays on screen.

---

## [1.4.0] - 2026-05-29

### Added
- **Auto-connect** — connections can be flagged to open automatically on launch via a checkbox in the connection modal.
- **Split view** — display up to 3 terminal sessions side by side. Supports vertical (default) and horizontal split directions, configurable in Settings. Panes are resizable by dragging the divider.

### Fixed
- TRM working directory: `~` in the path is now correctly expanded on Windows.
- Split view 3-pane layout bug resolved.
- xterm.js canvas artifacts after fit/resize eliminated.

---

## [1.3.2] - 2026-05-22

### Fixed
- TRM working directory: paths starting with `~` are now correctly expanded to the user's home directory.

---

## [1.3.1] - 2026-05-22

### Fixed
- TRM terminal: set `TERM=xterm-256color` and `COLORTERM=truecolor` on the spawned shell so color output works correctly.

---

## [1.3.0] - 2026-05-22

### Added
- **TRM connection type** — embed a local terminal session in a tab. Supports a configurable working directory and shell (defaults to `$SHELL` on Linux/macOS, `powershell.exe` on Windows). The `$_` icon distinguishes TRM connections in the sidebar and tab bar.
- **Categories** — a new organizational layer above groups. Add a category via the Layers icon in the sidebar header; assign groups to a category via Edit Group. Categories render as full-width bars for clear visual separation, collapse/expand independently, and support right-click rename and delete. Deleting a category uncategorizes its groups without removing them.
- **Duplicate opens edit modal** — right-clicking a connection and choosing Duplicate now opens the "Duplicate Connection" modal pre-filled with the original's data (label gets " (copy)" appended, password is pre-loaded). The connection is only created on Save, so you can adjust anything before committing.

### Fixed
- Group credentials display: connections using group credentials now show the group's username in the sidebar (`groupuser@host`) instead of their own stored username.

---

## [1.2.1] - 2025-05-14

### Fixed
- Global hotkey no longer fires during paste in SSH terminal sessions.
- Windows CI: pass `GITHUB_TOKEN` to `setup-protoc` to avoid API rate limiting.

---

## [1.2.0] - 2025-05-13

### Added
- **SSH jump host (ProxyJump) support** — route SSH and RDP connections through a bastion/jump host. Configure per-connection in the edit modal.

### Fixed
- Security hardening pass: addressed critical and high findings from internal code review.

---

## [1.0.5] - 2025-04-xx

### Added
- In-app update installer. SlimRDM checks for new releases on launch and can download and install them without leaving the app.
- NSIS-only Windows builds (removed MSI).

---

## [1.0.4] - 2025-04-xx

### Added
- Report Issue shortcut linking to the GitHub issue tracker.
