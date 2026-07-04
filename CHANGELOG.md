# Changelog

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
