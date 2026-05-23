# Changelog

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
