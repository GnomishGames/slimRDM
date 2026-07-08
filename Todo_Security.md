# SlimRDM Security TODO

Findings from a full security audit (Rust backend, Tauri config/capabilities, React
frontend, and dependency audits). Working tree was clean at audit time; these are
issues in the app itself, not in any pending diff.

**How to use this file:** each item is self-contained and written so a less-capable
model can execute it without re-deriving context. Do the items in roughly the order
listed (highest urgency × ROI first). After completing an item, check its box, note
the commit, and run the verification step. Do **not** batch unrelated items into one
commit — one item per commit so they can be reviewed and reverted independently.

## Ratings legend

- **Effort** — S (< 1h), M (half day), L (multi-day / needs upstream work).
- **ROI** — how much security benefit per unit effort (Low / Med / High / Very High).
- **Urgency** — how soon it should be done (P0 = now, P1 = this release, P2 = soon,
  P3 = opportunistic).

## Threat model (read first)

The app does **not** load remote web content, and the React frontend escapes all
untrusted strings (no `innerHTML`/`eval`/`dangerouslySetInnerHTML` anywhere). So the
bar for injecting script into the webview is high. **But** several backend commands are
powerful enough that a *single* frontend compromise (e.g. a malicious npm package in
the UI bundle, or a future XSS) escalates straight to credential theft or code
execution. Items 1–4 break that escalation chain and are the highest-value work.

---

## Item 1 — `get_credential` exposes every stored password to the webview

- **File:** `src-tauri/src/commands/credentials.rs:43`
- **Effort:** S · **ROI:** Very High · **Urgency:** P0

**Problem.** The `get_credential(ref_key)` Tauri command returns any keyring password
to the frontend for an arbitrary `ref_key`. Any script running in the webview can
enumerate/guess ref keys (`host:port:username`) and exfiltrate every stored password.
The backend SSH/RDP handlers already fetch credentials themselves via
`get_credential_async`, so the frontend should rarely — ideally never — need the
plaintext.

**Plan.**
1. Search the frontend for callers: `grep -rn "get_credential\|getCredential" src`.
   Also check `src/utils/tauri.ts` for the wrapper.
2. If there are **no** callers, delete the `get_credential` command entirely and remove
   it from the `invoke_handler!` list in `src-tauri/src/lib.rs`.
3. If there **are** callers, determine what they actually need:
   - If they only check whether a credential *exists*, add a
     `has_credential(ref_key) -> bool` command that returns a boolean only, and switch
     callers to it.
   - If a caller genuinely needs the plaintext (e.g. to pre-fill an edit form), that is
     a design smell — prefer letting the user re-enter the password on edit rather than
     round-tripping it through the webview.
4. Keep `save_credential` and `delete_credential` (writes are not exfiltration).

**Verification.** App still connects (password auth SSH + RDP) and credential
save/delete still works. `grep` confirms no remaining `get_credential` invocation.

---

## Item 2 — CSP allows `script-src 'unsafe-inline'`

- **File:** `src-tauri/tauri.conf.json:29`
- **Effort:** S · **ROI:** High · **Urgency:** P1

**Problem.** The CSP is
`... script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; ...`.
`'unsafe-inline'` on `script-src` largely defeats the CSP's XSS protection — injected
inline `<script>` runs. Vite production builds normally emit external script files and
do not need inline script.

**Plan.**
1. Remove `'unsafe-inline'` from **`script-src` only**. Leave it on `style-src`
   (styled-components / inline styles commonly need it; removing there is a separate,
   lower-value effort).
   New value: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'`
2. Build a production bundle and run it (`npm run tauri build` then launch, or
   `npm run tauri dev` if dev still uses the prod CSP path — note dev may need a relaxed
   CSP; if so, only tighten the bundled/prod config).
3. Open devtools console and confirm no CSP violation errors and the UI renders/behaves
   normally.

**Verification.** App loads and is fully functional with no CSP violations in the
console. If a violation appears, identify the inline script source (often a bundler
shim) and fix the source rather than re-adding `unsafe-inline`.

---

## Item 3 — Update installer URL check is bypassable; no integrity verification

- **File:** `src-tauri/src/commands/updates.rs:63-91`
- **Effort:** M · **ROI:** High · **Urgency:** P1

**Problem.** `download_and_install_update` guards with
`url.starts_with(RELEASE_URL_PREFIX)`. A string like
`https://github.com/GnomishGames/slimRDM/releases/download/../../../Attacker/repo/releases/download/v1/evil.exe`
passes the prefix check but normalizes (at the HTTP layer) to a **different repo**, and
the downloaded file is then **executed**. Additionally the temp filename is derived from
`url.split('/').last()` with no sanitization, and the download has no hash/signature
check.

**Plan.**
1. Parse the URL with the `url` crate instead of `starts_with`:
   - Require `scheme == "https"` and `host_str() == Some("github.com")`.
   - Split `path_segments()` and require the path begins exactly with
     `["GnomishGames", "slimRDM", "releases", "download", ...]`.
   - Reject any segment equal to `..` or `.` (defense in depth; a parsed URL usually
     won't contain them, but check explicitly).
2. Sanitize the temp filename: strip any path separators and `..`; if empty, fall back
   to a fixed name. Never let the server control the on-disk path outside `temp_dir()`.
   Consider using the release `tag_name` + a fixed extension instead of the URL basename.
3. **Integrity check (the real fix):** in `check_for_updates`, the GitHub release JSON
   should carry a digest. Capture the expected SHA-256 (either a `.sha256` sidecar asset
   or GitHub's asset `digest` field if present) and pass it to
   `download_and_install_update`; after download, compute SHA-256 of the bytes and
   refuse to launch on mismatch. If no digest source is available, at minimum document
   that the channel relies on HTTPS + repo pinning only.
4. `url` is already a transitive dependency (via reqwest); add it to `Cargo.toml`
   `[dependencies]` explicitly so the import is stable.

**Verification.** A crafted URL with `..` segments or a different repo/host is rejected.
A legitimate release URL downloads and (if a digest is wired up) only launches on a hash
match. Add a `#[cfg(test)]` unit test for the URL validator with both good and malicious
inputs.

---

## Item 4 — `trm_connect` is an arbitrary-command-execution primitive

- **File:** `src-tauri/src/commands/trm.rs:48-113`
- **Effort:** M · **ROI:** Med · **Urgency:** P2

**Problem.** The webview supplies `shell_path`, `working_directory`, and
`startup_commands`, and the backend spawns that binary. For a terminal feature this is
partly inherent, but it means a webview compromise can launch *any* binary with any
args directly, bypassing the SSH/RDP paths entirely.

**Plan.**
1. Add an allowlist of acceptable shells resolved on the backend, not trusted from the
   frontend:
   - Windows: `powershell.exe`, `pwsh.exe`, `cmd.exe` (match on the basename, not a
     caller-supplied absolute path).
   - Unix: the entries in `/etc/shells`, plus `$SHELL`, plus `/bin/sh`.
2. When `shell_path` is provided, resolve it to a basename and confirm it is in the
   allowlist; reject otherwise with a clear error. Do not let the frontend pass an
   arbitrary absolute path to an unknown executable.
3. Consider whether `working_directory` should be constrained (probably fine to leave
   open for a local terminal, but note it in a comment).
4. Leave `startup_commands` as-is functionally (a local terminal legitimately runs
   commands), but the shell allowlist ensures they run in a known interpreter.

**Verification.** Launching the local terminal with a default/blank shell still works on
Windows and Unix; passing a non-allowlisted `shell_path` is rejected.

---

## Item 5 — `{password}` substitution in SSH startup commands can leak the password

- **File:** `src-tauri/src/commands/ssh.rs:466-480`
- **Effort:** M · **ROI:** Med · **Urgency:** P2

**Problem.** Startup commands support `{password}` substitution, typed into the remote
shell as keystrokes. If used as a command argument it lands in the remote shell history,
and if the remote echoes it, the session logger captures it — the redaction patterns in
`logging.rs` only match `password: <x>`-shaped text (`BUILTIN_PATTERNS`), not a bare
echoed password value.

**Plan.**
1. In the Settings/connection UI where startup commands are edited, show a warning when
   `{password}` is present: "The password will be typed into the remote shell and may be
   stored in its history or captured in session logs."
2. Logger-side masking: when a session has a known password (the `stored_pw` in
   `ssh.rs`), pass that literal value to the `SessionLogger` so `redact()` can mask exact
   occurrences of it in captured output. Plumb an optional
   `literal_secrets: Vec<String>` into `SessionLogParams`/`redact` and mask them first.
   Be careful never to write the password itself to disk (including not logging it in
   `ssh_log`).
3. Confirm `ssh_log` at `ssh.rs:341` never logs the password (it currently logs only
   `pw_len` — keep it that way; do not add the value).

**Verification.** A session whose transcript echoes the password shows `████` in the
written note, not the plaintext. Unit-test `redact()` with a literal-secret argument.

---

## Item 6 — Host-key fingerprints hash the Rust `Debug` format; jump-host mismatch is silent

- **Files:** `src-tauri/src/commands/ssh.rs:229`,
  `src-tauri/src/commands/tunnel_utils.rs:46-47`
- **Effort:** M · **ROI:** Med · **Urgency:** P2

**Problem (a).** Fingerprints are `Sha256(format!("{server_public_key:?}"))`. This is
stable only as long as russh's `Debug` impl doesn't change — a future russh upgrade
(currently vendored 0.44, see Item 9) would silently invalidate every stored known-host
entry, and the value can't be compared against standard OpenSSH `SHA256:` fingerprints
out of band.

**Problem (b).** On a jump host, a key *mismatch* returns `Ok(false)`
(`tunnel_utils.rs:47`), surfacing as a generic connection failure instead of the
explicit MITM warning the direct-connect path emits.

**Plan.**
1. Replace the Debug-hash with russh's real fingerprint. `russh_keys::PublicKey` exposes
   a fingerprint method (e.g. `.fingerprint()` / SHA-256 fingerprint helper). Emit the
   standard OpenSSH form (`SHA256:base64nopad`) so it matches `ssh-keyscan`/`ssh` output.
2. **Migration:** existing `known_hosts.json` entries use the old hash. Options:
   - Simplest: bump a version marker and treat all old entries as absent (users
     re-TOFU on next connect). Acceptable for a small user base — document it in release
     notes.
   - Nicer: on mismatch where the stored value looks like the old format, re-derive and
     compare, upgrading the entry in place. More code; only if churn matters.
3. For the jump host, thread the mismatch message through the same way the direct path
   does: emit an `ssh-status` error event with the MITM warning text from
   `known_hosts::check_or_store`'s `Err`, rather than collapsing to `false`.

**Verification.** Fingerprint printed/stored matches `ssh-keyscan -t <type> host | ssh-keygen -lf -`
output. A changed jump-host key produces a clear MITM warning, not a generic failure.

---

## Item 7 — Legacy SSH crypto always enabled

- **File:** `src-tauri/src/commands/ssh.rs:166-198`
- **Effort:** M · **ROI:** Low-Med · **Urgency:** P3

**Problem.** `diffie-hellman-group1-sha1`, `ssh-rsa` (SHA-1), and CBC ciphers are added
to the preferred lists globally for Cisco compatibility. Servers negotiate the strongest
mutual algorithm, so this mainly matters against an *active* downgrade attacker — but it
widens the default attack surface for everyone to serve a few legacy devices.

**Plan.**
1. Add a per-connection boolean (e.g. `allow_legacy_crypto`) to the connection record
   and `SshConnectParams`, default `false`.
2. Build the `Preferred` struct in two tiers: a modern-only list by default, and the
   extended list (current behavior) only when the flag is set.
3. Surface the toggle in the connection edit UI with a short "needed for old switches /
   routers" hint.

**Verification.** A modern server still connects with the flag off; a legacy device
(or a test server configured with only `diffie-hellman-group14-sha1`) connects only
with the flag on.

---

## Item 8 — Verbose diagnostic logging of connection metadata

- **Files:** `src-tauri/src/commands/ssh.rs:537-553`, `src-tauri/src/lib.rs:16-21`
- **Effort:** S · **ROI:** Low · **Urgency:** P3

**Problem.** `ssh_log` writes hosts, usernames, credential-ref names, and password
*lengths* to a plaintext `ssh.log`; `lib.rs` sets russh to `Debug`. No secrets are
written, but it is more metadata than needed and the russh Debug channel is noisy.
Also `ssh_log` builds its path from `$HOME/.local/share/...`, which is POSIX-only —
on Windows `$HOME` is usually unset so this largely writes nothing / to the wrong place
(dead code on the primary platform).

**Plan.**
1. Route `ssh_log` through the same `app_data_dir`-based path the main logger uses,
   instead of the hardcoded `$HOME/.local/share/slimrdm/ssh.log`. Or remove `ssh_log`
   entirely and use `log::debug!`/`log::info!` so it flows into `slimrdm.log` with the
   existing rotation.
2. Drop the `pw_len` field from the auth log line — it's a (weak) length oracle and adds
   nothing operationally useful.
3. Lower russh from `Debug` to `Info` or `Warn` in `lib.rs:17` for release builds
   (Debug can include protocol-level detail); keep Debug behind a debug-build cfg if
   wanted for troubleshooting.

**Verification.** Logs still capture connect/auth outcomes for troubleshooting, without
password lengths, and the file lands in the app data dir on Windows.

---

## Item 9 — Dependency hygiene

- **Files:** `package.json` / `package-lock.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`
- **Effort:** S (npm) / L (russh) · **ROI:** Med · **Urgency:** P1 (npm), P2 (rust)

**`npm audit` (3 findings, all dev-only tooling):**
- **vite 7.0.0–7.3.3** — high: `server.fs.deny` bypass on Windows + `launch-editor`
  NTLMv2 hash disclosure. Dev server only, not shipped.
- **esbuild 0.27.3–0.28.0** — low: dev-server arbitrary file read on Windows.
- **@babel/core ≤ 7.29.0** — low: arbitrary file read via `sourceMappingURL`.

**Plan (npm).**
1. Run `npm audit fix`. Re-run `npm audit` to confirm 0 findings.
2. Smoke-test dev + build: `npm run tauri dev` launches, `npm run build` succeeds.
   (vite is a major-version-sensitive dep; if `audit fix` wants a breaking bump, verify
   the build carefully or pin to the latest safe 7.x patch.)

**Plan (Rust).**
1. `cargo install cargo-audit`, then `cargo audit --file src-tauri/Cargo.lock`. Triage
   whatever it reports.
2. **russh is vendored** via `[patch.crates-io] russh = { path = "vendor/russh" }` at
   `Cargo.toml:67-68`, pinned to 0.44 — upstream security fixes do **not** reach this
   build. Document *why* it's vendored (there's a note in `ssh.rs` about a PAM
   `INFO_REQUEST` inline-response patch). Plan to either (a) upstream the patch and move
   to a current russh release, or (b) periodically rebase the vendored copy onto upstream
   security releases. Until then, watch RUSTSEC advisories for russh/russh-keys manually.

**Plan (CI).**
3. Add `npm audit --audit-level=high` and `cargo audit` as CI steps so regressions are
   caught automatically.

**Verification.** `npm audit` clean; `cargo audit` triaged; CI fails on new high-severity
advisories.

---

## Suggested execution order

1. Item 1 (remove/restrict `get_credential`) — P0, S, Very High ROI.
2. Item 2 (drop `script-src 'unsafe-inline'`) — P1, S, High ROI.
3. Item 9 npm (`npm audit fix`) — P1, S, Med ROI.
4. Item 3 (update URL validation + integrity) — P1, M, High ROI.
5. Items 5, 6, 4 — P2, M each.
6. Item 9 rust (cargo-audit + russh plan), Items 7, 8 — P2/P3.
