# Session Logging → Obsidian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture SSH sessions as clean, redacted markdown notes in an Obsidian vault (per-session notes + a daily index), so external Obsidian tooling can summarize/search them.

**Architecture:** Rust backend taps the existing SSH output point (`ClientHandler::data` in `ssh.rs`), streams raw bytes to a per-session working file (crash-safe), and a per-session checkpoint task cleans → redacts → renders markdown into the vault. Enablement is resolved on the frontend (connection/group/global) and passed to `ssh_connect`. SlimRDM never summarizes or searches — Obsidian does.

**Tech Stack:** Rust (Tauri 2), `regex` (redaction), `chrono` (local timestamps), tokio; React/TypeScript + Zustand + `tauri-plugin-dialog` on the frontend.

## Global Constraints

- Session logging is **OFF by default**; capture only when the frontend resolves it on.
- Logging must be **non-fatal**: no logging error may break, block, or slow the SSH session. Log failures to `slimrdm.log`.
- **SSH only** in v1 (no RDP capture).
- Redaction is **best-effort**, applied after cleaning.
- Raw `.raw` files are **deleted on successful finalize**; unredacted data must not persist.
- Follow existing patterns: `#[serde(rename_all = "camelCase")]` on FE-facing structs; frontend group-inheritance mirrors `resolveCredentials` in `useSshTerminal.ts`.

---

## Phase 1 — Backend core (pure/temp-dir, no SSH needed)

### Task 1: Dependencies + module skeleton

**Files:**
- Modify: `src-tauri/Cargo.toml` (deps)
- Create: `src-tauri/src/commands/logging.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod logging;`)

**Interfaces:**
- Produces: the `crate::commands::logging` module compiling as an empty stub.

- [ ] **Step 1:** Add to `[dependencies]` in `Cargo.toml`:
```toml
regex = "1"
chrono = { version = "0.4", features = ["clock"] }
```
- [ ] **Step 2:** Create `src-tauri/src/commands/logging.rs` with `//! Session logging → Obsidian vault.` and nothing else.
- [ ] **Step 3:** Add `pub mod logging;` to `src-tauri/src/commands/mod.rs` (alongside the other `pub mod` lines).
- [ ] **Step 4:** Run `cargo build` (in `src-tauri`). Expected: compiles clean.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "chore: add regex+chrono deps and logging module skeleton"`

---

### Task 2: `clean()` — transcript cleaning

**Files:**
- Modify: `src-tauri/src/commands/logging.rs`
- Test: same file, `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `pub fn clean(raw: &str) -> String`

- [ ] **Step 1: Write failing tests**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_sgr_color_codes() {
        assert_eq!(clean("\x1b[32mhello\x1b[0m world"), "hello world");
    }

    #[test]
    fn collapses_carriage_return_overwrites() {
        // progress bar rewriting the same line ends on the final state
        assert_eq!(clean("10%\r50%\r100%\n"), "100%");
    }

    #[test]
    fn replaces_alt_screen_region_with_marker() {
        let raw = "before\x1b[?1049hVIM STUFF\x1b[?1049lafter";
        assert_eq!(clean(raw), "before\n[interactive application]\nafter");
    }

    #[test]
    fn strips_osc_title_sequence() {
        assert_eq!(clean("\x1b]0;my title\x07prompt$ "), "prompt$ ");
    }

    #[test]
    fn collapses_excess_blank_lines() {
        assert_eq!(clean("a\n\n\n\n\nb"), "a\n\nb");
    }
}
```
- [ ] **Step 2:** Run `cargo test --lib logging::tests::clean -- --nocapture` (or `cargo test clean`). Expected: FAIL (clean not defined).
- [ ] **Step 3: Implement**
```rust
/// Turn a raw terminal output stream into a readable plain-text transcript:
/// remove alt-screen (TUI) regions, apply carriage-return overwrites, strip
/// ANSI/OSC escapes and stray control chars, and normalise blank lines.
pub fn clean(raw: &str) -> String {
    let without_alt = replace_alt_screen(raw);
    let mut out_lines: Vec<String> = Vec::new();
    for segment in without_alt.split('\n') {
        out_lines.push(apply_carriage_returns_and_escapes(segment));
    }
    // Trim trailing whitespace per line, drop trailing empties, collapse blank runs.
    let mut result: Vec<String> = Vec::new();
    let mut blanks = 0;
    for line in out_lines {
        let trimmed = line.trim_end().to_string();
        if trimmed.is_empty() {
            blanks += 1;
            if blanks <= 1 { result.push(String::new()); }
        } else {
            blanks = 0;
            result.push(trimmed);
        }
    }
    while result.first().map_or(false, |l| l.is_empty()) { result.remove(0); }
    while result.last().map_or(false, |l| l.is_empty()) { result.pop(); }
    result.join("\n")
}

fn replace_alt_screen(raw: &str) -> String {
    // Replace ESC[?1049h..ESC[?1049l (and legacy ?47) regions with a marker.
    let re = Regex::new(r"\x1b\[\?(?:1049|47)h.*?\x1b\[\?(?:1049|47)l")
        .unwrap();
    // (?s) so '.' matches newlines inside the region.
    let re = Regex::new(&format!("(?s){}", re.as_str())).unwrap();
    re.replace_all(raw, "\n[interactive application]\n").into_owned()
}

fn apply_carriage_returns_and_escapes(segment: &str) -> String {
    // Keep only the text after the last carriage return (final overwrite state).
    let last = segment.rsplit('\r').next().unwrap_or(segment);
    strip_escapes(last)
}

fn strip_escapes(s: &str) -> String {
    // CSI (ESC[ ... final-byte), OSC (ESC] ... BEL|ST), and lone escapes.
    let csi = Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]").unwrap();
    let osc = Regex::new(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)").unwrap();
    let other = Regex::new(r"\x1b[@-Z\\-_]").unwrap();
    let s = csi.replace_all(s, "");
    let s = osc.replace_all(&s, "");
    let s = other.replace_all(&s, "");
    // Drop remaining control chars except tab.
    s.chars().filter(|&c| c == '\t' || !c.is_control()).collect()
}
```
Add `use regex::Regex;` at the top of the file.
- [ ] **Step 4:** Run `cargo test clean`. Expected: PASS (5 tests).
- [ ] **Step 5:** Commit: `git commit -am "feat(logging): add transcript clean() with tests"`

> Note: compiling `Regex` on every call is fine for tests; Task 5 wraps `clean` behind a checkpoint that runs at most every 4s, so it's not hot. If profiling later shows cost, hoist into `once_cell` statics — not needed now (YAGNI).

---

### Task 3: `redact()` — best-effort secret masking

**Files:**
- Modify: `src-tauri/src/commands/logging.rs`

**Interfaces:**
- Produces: `pub fn redact(text: &str, user_patterns: &[String]) -> String`

- [ ] **Step 1: Write failing tests**
```rust
#[test]
fn redacts_key_value_secrets() {
    let out = redact("password: hunter2\napikey=ABC123", &[]);
    assert!(out.contains("████"), "got: {out}");
    assert!(!out.contains("hunter2"));
    assert!(!out.contains("ABC123"));
}

#[test]
fn redacts_aws_access_key() {
    let out = redact("key AKIAIOSFODNN7EXAMPLE here", &[]);
    assert!(!out.contains("AKIAIOSFODNN7EXAMPLE"));
}

#[test]
fn applies_user_pattern() {
    let out = redact("token PRIVATE-XYZ done", &[r"PRIVATE-\w+".to_string()]);
    assert!(!out.contains("PRIVATE-XYZ"));
    assert!(out.contains("done"));
}

#[test]
fn invalid_user_pattern_is_ignored() {
    // must not panic on a bad regex
    let out = redact("safe text", &["(".to_string()]);
    assert_eq!(out, "safe text");
}
```
- [ ] **Step 2:** Run `cargo test redact`. Expected: FAIL.
- [ ] **Step 3: Implement**
```rust
const BUILTIN_PATTERNS: &[&str] = &[
    r"(?i)(password|passwd|secret|token|api[_-]?key|bearer)\s*[:=]\s*(\S+)",
    r"AKIA[0-9A-Z]{16}",
    r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
];

/// Best-effort redaction. Replaces the secret span of each match with ████.
/// Built-in patterns run first, then user-supplied regexes. Invalid user
/// regexes are skipped (never panics).
pub fn redact(text: &str, user_patterns: &[String]) -> String {
    let mut out = text.to_string();
    for pat in BUILTIN_PATTERNS {
        let re = Regex::new(pat).unwrap();
        out = re
            .replace_all(&out, |caps: &regex::Captures| {
                // If there's a capture group 2 (the value), keep the label and mask the value.
                if let Some(val) = caps.get(2) {
                    caps[0].replacen(val.as_str(), "████", 1)
                } else {
                    "████".to_string()
                }
            })
            .into_owned();
    }
    for pat in user_patterns {
        if let Ok(re) = Regex::new(pat) {
            out = re.replace_all(&out, "████").into_owned();
        }
    }
    out
}
```
- [ ] **Step 4:** Run `cargo test redact`. Expected: PASS (4 tests).
- [ ] **Step 5:** Commit: `git commit -am "feat(logging): add best-effort redact() with tests"`

---

### Task 4: Note rendering (pure)

**Files:**
- Modify: `src-tauri/src/commands/logging.rs`

**Interfaces:**
- Produces:
  - `pub struct NoteMeta { pub host: String, pub port: u16, pub username: String, pub group: Option<String>, pub connection_id: String, pub tags: Vec<String>, pub start: chrono::DateTime<chrono::Local>, pub end: Option<chrono::DateTime<chrono::Local>> }`
  - `pub fn render_session_note(meta: &NoteMeta, transcript: &str) -> String`
  - `pub fn session_note_stem(meta: &NoteMeta) -> String` → e.g. `2026-06-30 web01 (14-02)`
  - `pub fn daily_note_body() -> String` (fresh daily note skeleton with empty `## Summary` + empty `## Sessions`)

- [ ] **Step 1: Write failing tests** (use a fixed timestamp)
```rust
use chrono::TimeZone;

fn fixed_meta() -> NoteMeta {
    NoteMeta {
        host: "web01".into(), port: 22, username: "deploy".into(),
        group: Some("Production".into()), connection_id: "abc".into(),
        tags: vec!["slimrdm".into(), "ssh".into()],
        start: chrono::Local.with_ymd_and_hms(2026, 6, 30, 14, 2, 11).unwrap(),
        end: Some(chrono::Local.with_ymd_and_hms(2026, 6, 30, 14, 3, 41).unwrap()),
    }
}

#[test]
fn session_stem_uses_host_and_start_time() {
    assert_eq!(session_note_stem(&fixed_meta()), "2026-06-30 web01 (14-02)");
}

#[test]
fn session_note_has_frontmatter_and_transcript() {
    let note = render_session_note(&fixed_meta(), "line1\nline2");
    assert!(note.starts_with("---\n"));
    assert!(note.contains("host: web01"));
    assert!(note.contains("duration: 1m30s"));
    assert!(note.contains("## Transcript"));
    assert!(note.contains("line1\nline2"));
}

#[test]
fn daily_body_has_summary_and_sessions_headings() {
    let b = daily_note_body();
    assert!(b.contains("## Summary"));
    assert!(b.contains("## Sessions"));
}
```
- [ ] **Step 2:** Run `cargo test logging`. Expected: FAIL.
- [ ] **Step 3: Implement** `NoteMeta`, a `fn fmt_duration(secs)` → `"1m30s"`/`"2h5m"`, `session_note_stem` (`format!("{} {} ({})", date, host_short, hh_mm)` where `host_short` is the host up to the first `.`), `render_session_note` (YAML frontmatter with the listed fields + fenced ```text block), and `daily_note_body`. Use `start.format("%Y-%m-%d")`, `start.format("%H-%M")`, RFC3339-ish `%Y-%m-%dT%H:%M:%S` for start/end.
- [ ] **Step 4:** Run `cargo test logging`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -am "feat(logging): render session + daily notes"`

---

### Task 5: Vault writer (temp-dir tests)

**Files:**
- Modify: `src-tauri/src/commands/logging.rs`

**Interfaces:**
- Produces:
  - `pub fn write_session_note(vault: &Path, meta: &NoteMeta, transcript: &str) -> std::io::Result<PathBuf>` — writes `SlimRDM/<YYYY>/<MM-DD>/<stem>.md`, returns its path.
  - `pub fn upsert_daily_index(vault: &Path, meta: &NoteMeta) -> std::io::Result<()>` — creates `Daily/<YYYY-MM-DD>.md` if missing, appends `- [[<stem>]]` under `## Sessions` if not already present. Guarded by a module-level `Mutex`.

- [ ] **Step 1: Write failing tests** (use `std::env::temp_dir()` + a uuid subdir; no extra dev-deps)
```rust
#[test]
fn writes_session_note_to_dated_path() {
    let vault = std::env::temp_dir().join(format!("slimrdm-test-{}", uuid::Uuid::new_v4()));
    let p = write_session_note(&vault, &fixed_meta(), "hello").unwrap();
    assert!(p.ends_with("SlimRDM/2026/06-30/2026-06-30 web01 (14-02).md"));
    let body = std::fs::read_to_string(&p).unwrap();
    assert!(body.contains("hello"));
    std::fs::remove_dir_all(&vault).ok();
}

#[test]
fn daily_index_creates_and_dedupes() {
    let vault = std::env::temp_dir().join(format!("slimrdm-test-{}", uuid::Uuid::new_v4()));
    upsert_daily_index(&vault, &fixed_meta()).unwrap();
    upsert_daily_index(&vault, &fixed_meta()).unwrap(); // idempotent
    let daily = vault.join("Daily/2026-06-30.md");
    let body = std::fs::read_to_string(&daily).unwrap();
    assert_eq!(body.matches("[[2026-06-30 web01 (14-02)]]").count(), 1);
    std::fs::remove_dir_all(&vault).ok();
}
```
- [ ] **Step 2:** Run `cargo test logging`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions. Create parent dirs with `std::fs::create_dir_all`. For `upsert_daily_index`: lock a `lazy_static`/`once_cell` `Mutex<()>`; read existing daily file (or `daily_note_body()`), if the `[[stem]]` link is absent append `- [[stem]]\n` after the `## Sessions` line, write back atomically (write to `<file>.tmp` then rename).
- [ ] **Step 4:** Run `cargo test logging`. Expected: PASS (all logging tests green).
- [ ] **Step 5:** Commit: `git commit -am "feat(logging): vault writer for session + daily notes"`

---

## Phase 2 — Backend wiring

### Task 6: `SessionLogger` + checkpoint task

**Files:**
- Modify: `src-tauri/src/commands/logging.rs`

**Interfaces:**
- Consumes: `clean`, `redact`, `NoteMeta`, `write_session_note`, `upsert_daily_index`.
- Produces:
  - `pub struct SessionLogParams { pub vault_path: String, pub group: Option<String>, pub tags: Vec<String>, pub redaction_patterns: Vec<String> }` (`#[serde(rename_all = "camelCase")]`, `Deserialize`, `Clone`).
  - `pub struct SessionLogger` with:
    - `pub fn start(session_id: &str, host: &str, port: u16, username: &str, connection_id: &str, params: SessionLogParams) -> SessionLogger` — opens `<app_local_data>/session-logs/<session_id>.raw`, records `start = Local::now()`, spawns the checkpoint task.
    - `pub fn append(&self, bytes: &[u8])` — append raw to file, bump `last_output`. All errors swallowed to `slimrdm.log`.
    - `pub async fn finalize(self)` — stop the task, do a final checkpoint with `end = Some(Local::now())`, delete the `.raw` on success.

**Design notes for the implementer:**
- Inner state behind `Arc<Mutex<Inner>>`: `{ raw_path, meta: NoteMeta, redaction_patterns, last_output: Instant, last_checkpoint: Instant }`. The raw file is opened append-only; `append` writes directly (no need to hold bytes in memory — re-read the file at checkpoint).
- `checkpoint()`: read whole `.raw` (UTF-8 lossy) → `clean` → `redact` → `write_session_note`; on the **first** successful write also call `upsert_daily_index`. Update `meta.end` when finalizing.
- Checkpoint task: `tokio::spawn` a loop with `tokio::time::interval(Duration::from_secs(1))`; each tick lock inner, and if `last_output.elapsed() >= 4s` OR `last_checkpoint.elapsed() >= 90s`, run checkpoint and reset `last_checkpoint`. Hold a `tokio::sync::Notify` or an `AtomicBool` stop flag; `finalize` sets it and awaits the join handle.
- Base dir: `app.path().app_local_data_dir()` — pass an `AppHandle` into `start`, or resolve the dir once and pass the `PathBuf`. Prefer passing `raw_dir: PathBuf` to keep `SessionLogger` testable.

- [ ] **Step 1:** Write a test that constructs a `SessionLogger` with a temp `raw_dir` + temp vault, calls `append(b"echo hi\r\nhi\n")`, `finalize().await`, and asserts the session note exists, contains `hi`, and the `.raw` file is gone. (Use `#[tokio::test]`.)
- [ ] **Step 2:** Run `cargo test logging`. Expected: FAIL.
- [ ] **Step 3:** Implement per the design notes above.
- [ ] **Step 4:** Run `cargo test logging`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -am "feat(logging): SessionLogger with idle/cap checkpoint task"`

---

### Task 7: Hook logger into the SSH session

**Files:**
- Modify: `src-tauri/src/commands/ssh.rs`

**Interfaces:**
- Consumes: `SessionLogger`, `SessionLogParams`.
- Adds field to `SshConnectParams`: `pub logging: Option<crate::commands::logging::SessionLogParams>`.

- [ ] **Step 1:** Add `logging: Option<SessionLogParams>` to `SshConnectParams` (after `jump_host_params`).
- [ ] **Step 2:** In `run_ssh_session`, after auth succeeds and before the input loop, build an `Option<SessionLogger>` from `params.logging` (resolve `raw_dir` from `app.path().app_local_data_dir()`). Store an `Arc<SessionLogger>` clone inside `ClientHandler` (add `logger: Option<Arc<SessionLogger>>` field) so `data()` can call `self.logger.as_ref().map(|l| l.append(data))` right after emitting `ssh-output`.
- [ ] **Step 3:** On every `return` path out of `run_ssh_session` after the logger is created (graceful `Ok(true)`, disconnect `Ok(false)`, and `?` error paths), ensure `logger.finalize().await` runs. Simplest: wrap the input loop so the logger is finalized in the `tokio::spawn` block in `ssh_connect` after `run_ssh_session` returns — pass the logger out, or finalize inside `run_ssh_session` just before each return. Choose finalize-inside via a small helper to avoid missing a path.
- [ ] **Step 4:** `cargo build` + run existing tests: `cargo test`. Expected: compiles, existing tests still pass.
- [ ] **Step 5:** Commit: `git commit -am "feat(ssh): capture session output when logging is enabled"`

---

### Task 8: Orphaned `.raw` sweep on startup

**Files:**
- Modify: `src-tauri/src/lib.rs` (app setup)
- Modify: `src-tauri/src/commands/logging.rs` (add `pub fn sweep_orphans(raw_dir: &Path)`)

- [ ] **Step 1:** Add `sweep_orphans` that deletes any `*.raw` in the session-logs dir (they only exist after a crash; their content is unredacted and their note was already checkpointed). Add a test writing two `.raw` files in a temp dir and asserting they're gone after the sweep.
- [ ] **Step 2:** `cargo test logging`. Expected: FAIL then PASS after implementing.
- [ ] **Step 3:** Call `sweep_orphans` once in the Tauri `setup` hook in `lib.rs` using the resolved `app_local_data_dir`.
- [ ] **Step 4:** `cargo build`. Expected: clean.
- [ ] **Step 5:** Commit: `git commit -am "feat(logging): sweep orphaned raw capture files on startup"`

---

## Phase 3 — Frontend

### Task 9: Types, resolution, and connect param

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/store/settingsStore.ts` (add `logging` slice + persistence)
- Modify: `src/hooks/useSshTerminal.ts` (resolve + pass `logging`)
- Modify: `src/utils/tauri.ts` (extend `ssh.connect` param type if typed there)

**Interfaces:**
- `Connection.logSessions?: 'inherit' | 'on' | 'off'`
- `Group.logSessions?: 'inherit' | 'on' | 'off'`
- `LoggingSettings { enabled: boolean; vaultPath: string; redactionPatterns: string[] }`
- `resolveLogging(conn): SessionLogParams | undefined` — mirrors `resolveCredentials`: connection `on`/`off` wins → else group `on`/`off` → else `settings.logging.enabled`. Returns params (with `vaultPath`, `group` name, merged `tags`, `redactionPatterns`) only when resolved true **and** `vaultPath` is non-empty.

- [ ] **Step 1:** Add the type fields above and a `logging` slice to `settingsStore` with defaults `{ enabled: false, vaultPath: "", redactionPatterns: [] }`, persisted like the other settings slices.
- [ ] **Step 2:** Add `resolveLogging` in `useSshTerminal.ts` and include its result as `logging` in the `ssh.connect({...})` call.
- [ ] **Step 3:** `npm run build` (tsc) — expected: no type errors.
- [ ] **Step 4:** Commit: `git commit -am "feat(logging): frontend types, settings slice, connect wiring"`

---

### Task 10: Settings "Logging" section

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx`
- Modify: `src-tauri/capabilities/default.json` (ensure `dialog:allow-open` for folder pick, if not already present)

- [ ] **Step 1:** Add a "Logging" section: enable toggle; vault-folder picker button using `@tauri-apps/plugin-dialog` `open({ directory: true })` bound to `logging.vaultPath`; a textarea for `redactionPatterns` (one per line, split/join on save). Match the existing settings-section markup/classes.
- [ ] **Step 2:** Verify the folder dialog opens (manual) and the path persists across reload.
- [ ] **Step 3:** Commit: `git commit -am "feat(settings): logging section with vault picker and redaction editor"`

---

### Task 11: Per-connection / per-group tri-state field

**Files:**
- Modify: the connection edit modal component (search `src/components` for the form using `startupCommands`)
- Modify: the group edit modal component

- [ ] **Step 1:** Add a "Log sessions" `<select>` (Inherit / On / Off) bound to `logSessions` in both the connection and group forms; default `inherit`. Ensure the value is included in the create/update payload (remember: don't send `id`/`created_at` on create — see CLAUDE.md).
- [ ] **Step 2:** `npm run build`. Expected: no type errors.
- [ ] **Step 3:** Manual: set a connection to On with a test vault, connect over SSH, run a few commands, exit; confirm the session note + daily index appear in the vault and render in Obsidian, with a secret line redacted.
- [ ] **Step 4:** Commit: `git commit -am "feat(logging): per-connection and per-group log toggle"`

---

## Self-Review

**Spec coverage:** backend capture (T6–T7), cleaned fidelity (T2), per-session + daily notes (T4–T5), off-by-default + connection/group/global resolution (T9, T11), redaction built-in+user (T3), checkpoint 4s/90s (T6), delete-raw-on-finalize (T6), orphan sweep (T8), non-fatal errors (Global Constraints + T6/T7 swallow-to-log), RDP out of scope (Global Constraints). Note format matches spec (T4). Settings UI + vault picker (T10). ✔ All spec sections mapped.

**Placeholders:** none — core algorithms carry full code; wiring tasks carry exact interfaces + design notes (the SSH/React edits are localized and pattern-following, so prose + signatures suffice).

**Type consistency:** `clean`, `redact`, `NoteMeta`, `render_session_note`, `session_note_stem`, `daily_note_body`, `write_session_note`, `upsert_daily_index`, `SessionLogParams`, `SessionLogger::{start,append,finalize}` are used consistently across tasks; `SshConnectParams.logging: Option<SessionLogParams>` matches the frontend `resolveLogging` return.
