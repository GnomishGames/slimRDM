# Session Logging → Obsidian — Design

**Date:** 2026-06-30
**Status:** Approved, ready for implementation
**Stretch goal:** #9 (Session logging & searchable scrollback), Obsidian-focused variant

## Summary

Let SlimRDM reliably capture SSH sessions as clean, structured **markdown notes in an
Obsidian vault**, so the user's existing Obsidian tooling (built-in search + local-LLM
community plugins) can summarize the day's work and make it searchable. SlimRDM's
responsibility is **capture and structure only** — it never summarizes or searches.

Guiding ethos: **lightweight** (no bundled LLM, no background service, capture off by
default), **effective** (readable transcripts, zero shell setup), **reliable** (crash-safe
capture in the Rust backend; logging failures never affect the SSH session).

## Scope

**In scope (v1):**
- Capturing **SSH** sessions (and the design generalizes to the local `trm` terminal later).
- Cleaned-transcript fidelity: ANSI/redraw/alt-screen noise removed.
- Per-session markdown notes + an auto-maintained daily index note.
- Off-by-default enablement with per-connection (and group) opt-in + global toggle.
- Best-effort secret redaction: built-in patterns + user-supplied regexes.

**Out of scope (v1):**
- **RDP logging** — RDP is graphical; there is no text transcript. The daily note may
  record that an RDP session occurred (metadata only), but no capture.
- Any summarization, semantic search, or LLM integration inside SlimRDM (delegated to
  Obsidian).
- Full raw keystroke logging and command/output structuring (OSC 133). Possible later.

## Architecture

### Where capture happens: backend

Capture lives in the Rust backend, tapping the single point where SSH output already
arrives — `ClientHandler::data()` in `src-tauri/src/commands/ssh.rs`. Rationale:

- **Crash-safe & complete:** survives frontend refresh/crash; captures output even for a
  tab that was never rendered.
- **Single source of truth:** one tap, no frontend/terminal-buffer coupling.
- Chosen over the frontend alternative (serialize xterm.js's buffer), which is easier to
  clean but fragile and lossy.

### Data flow

```
ssh output chunk (ClientHandler::data)
    ├─→ emit "ssh-output" to frontend   (unchanged)
    └─→ SessionLogger.append(raw bytes) ─→ append to <appdata>/session-logs/<sessionId>.raw
                                            update last_output / buffer

checkpoint task (per session, ~1s tick):
    if idle ≥ 4s  OR  since_last_checkpoint ≥ 90s:
        read .raw → clean → redact → write/overwrite session note
        (first time only) create/append link in daily note

on session close:
    final checkpoint → finalize note (end time, duration) → delete .raw on success
```

### Components

- **`src-tauri/src/commands/logging.rs`** (new module)
  - `SessionLogParams` — passed from frontend on connect: `vault_path`, `connection_label`,
    `host`, `group_name: Option<String>`, `tags: Vec<String>`, `redaction_patterns:
    Vec<String>`. Present only when the frontend has resolved that this session should be
    logged.
  - `SessionLogger` — `Arc<Mutex<Inner>>` holding the raw file handle/path, buffer
    bookkeeping, `last_output: Instant`, `last_checkpoint: Instant`, start time, and config.
    - `append(bytes)` — write raw to disk, bump `last_output`.
    - `checkpoint()` — read raw → `clean()` → `redact()` → write session note; on first call,
      create/append the daily-index link.
    - `finalize()` — final checkpoint with end time + duration, then delete `.raw`.
  - Spawns one lightweight checkpoint task per logged session; aborted on finalize.
- **`clean(raw: &str) -> String`** (pure fn, unit-tested)
  1. Replace alt-screen regions (`ESC[?1049h`…`ESC[?1049l`, legacy `?47`) with
     `[interactive application]`.
  2. Apply carriage-return overwrites per line (collapses progress bars/spinners to their
     final state).
  3. Strip CSI/SGR escapes, OSC sequences (`ESC] … BEL/ST`), and stray control chars
     (keep `\t`, `\n`).
  4. Trim trailing whitespace; collapse 3+ blank lines to one.
- **`redact(text, patterns) -> String`** (pure fn, unit-tested)
  - Built-in patterns (best-effort): `(?i)(password|passwd|secret|token|api[_-]?key|bearer)
    \s*[:=]\s*\S+`, AWS access keys (`AKIA[0-9A-Z]{16}`), PEM private-key blocks. Plus
    user-supplied regexes. Matches (or the secret span) replaced with `████`.
- **Vault writer** (in `logging.rs`)
  - Layout: `SlimRDM/<YYYY>/<MM-DD>/<YYYY-MM-DD host (HH-MM)>.md` and
    `Daily/<YYYY-MM-DD>.md`, rooted at the configured vault path.
  - Daily-note updates guarded by a process-global `Mutex` (create-if-missing, append link
    under `## Sessions`, dedupe).

### Frontend

- **`src/types/index.ts`**
  - `Connection.logSessions?: 'inherit' | 'on' | 'off'` (default `inherit`).
  - `Group.logSessions?: 'inherit' | 'on' | 'off'` (default `inherit`).
  - New `LoggingSettings { enabled: boolean; vaultPath: string; redactionPatterns: string[] }`.
- **Resolution** (mirrors `resolveCredentials`): `connection` on/off wins → else `group`
  on/off → else global `enabled`. If resolved true and `vaultPath` set, the frontend
  includes `logging: SessionLogParams` in the `ssh_connect` call (new optional field on
  `SshConnectParams`).
- **Settings UI** — new "Logging" section: global enable toggle, vault-folder picker
  (Tauri dialog), redaction-pattern editor (textarea, one regex per line). Must be in
  `capabilities/default.json` if the dialog/fs permissions aren't already granted.
- **Connection & Group modals** — a tri-state "Log sessions" select (Inherit / On / Off).

## Note format

**Session note:**
```markdown
---
type: ssh
host: web01.example.com
port: 22
username: deploy
group: Production
connectionId: 4f3c…
tags: [slimrdm, ssh, production]
start: 2026-06-30T14:02:11
end: 2026-06-30T14:37:44
duration: 35m33s
---

## Transcript

```text
<cleaned, redacted transcript>
```
```

**Daily note (`Daily/2026-06-30.md`):**
```markdown
---
date: 2026-06-30
tags: [slimrdm, daily]
---

## Summary

<!-- left empty for your Obsidian LLM plugin to fill -->

## Sessions

- [[2026-06-30 web01 (14-02)]]
- [[2026-06-30 db01 (15-10)]]
```

SlimRDM creates the `## Summary` heading but never writes under it — that's the landing
spot for the user's Obsidian LLM plugin.

## Enablement & privacy

- **Off by default.** Global toggle + per-connection/group tri-state opt-in.
- **Redaction** is built-in patterns + user regexes, applied after cleaning; documented as
  **best-effort**, not a guarantee.
- Raw `.raw` working files hold unredacted output transiently and are **deleted on
  successful finalize**. Orphaned `.raw` files (from a crash) are swept on next startup.

## Checkpoint policy

Flush on **4s-idle OR 90s-since-last-checkpoint, whichever first**, plus always on close.
Idle-debounce lands on natural "command finished" boundaries and stays cheap for idle
sessions; the 90s cap bounds data loss for continuous-output sessions (`tail -f`). Each
checkpoint re-cleans the accumulated raw and rewrites the (small, bounded) session note —
no incremental-append complexity in v1.

## Error handling

- Logging is **non-fatal and invisible to the session**: a bad vault path, full disk, or
  write error must never break or interrupt SSH. Errors are logged to `slimrdm.log`.
- Settings surfaces a subtle "last log write failed" indicator so failures aren't silent
  to the user.

## Testing

- **Rust unit tests** for `clean()` (ANSI stripping, `\r` overwrite, alt-screen removal,
  control-char handling) and `redact()` (each built-in pattern + a user regex), driven by
  recorded raw-stream fixtures → expected markdown.
- **Vault-writer tests** against a temp dir: session-note render, daily-note create,
  daily-note append + dedupe, concurrent appends.
- **Manual:** end-to-end against a real SSH host with logging on, verifying notes land in a
  test vault and render in Obsidian.

## Implementation phases

1. **Backend core (TDD):** `clean()`, `redact()`, note rendering, vault writer + daily
   index — all pure/temp-dir testable, no SSH needed.
2. **Backend wiring:** `SessionLogger` + checkpoint task; hook `append`/`finalize` into
   `ssh.rs`; extend `SshConnectParams` with optional `logging`.
3. **Frontend:** types, resolution logic, `ssh_connect` param, Settings "Logging" section,
   connection/group tri-state field, capabilities.
4. **Polish:** orphaned-`.raw` sweep on startup, failure indicator, docs.
```
