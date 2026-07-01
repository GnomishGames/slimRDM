# Claude Session Journal → Obsidian — Design

**Date:** 2026-06-30
**Status:** Approved, ready for implementation
**Relationship:** Extends the session-logging feature. The user's primary goal is
capturing **Claude Code sessions** (a full-screen TUI) into Obsidian. Scraping the
terminal is the wrong tool for a TUI; instead SlimRDM ingests Claude Code's own JSONL
transcripts — higher fidelity and structured.

## Summary

SlimRDM reads Claude Code's transcript files under `~/.claude/projects/` and renders
readable per-session markdown notes into the same Obsidian vault used by SSH logging, plus
links each session into the shared daily index. Obsidian's search + local-LLM plugins then
summarize the day's work. SlimRDM only ingests and structures.

## Scope

**In scope (v1):**
- Discover top-level session transcripts: `~/.claude/projects/<dir>/<uuid>.jsonl`
  (**skip** nested `subagents/` files and any `isSidechain` events).
- Parse each transcript into an ordered conversation and render a markdown note.
- Write `Claude/<project>/<date> <sessionShort>.md`; link into `Daily/<date>.md` under a
  `## Claude Sessions` section (shared with SSH's `## Sessions`).
- Incremental sync via a state file (`file path → mtime`); re-render only changed files.
- Trigger: on app startup + a "Sync Claude sessions now" button in Settings → Logging.
- Config: reuse `logging.vaultPath`; add `logging.ingestClaude` toggle.

**Out of scope (v1):** live file-watching (manual/startup only), subagent transcripts,
rendering `thinking` blocks or full tool-result bodies, editing/summarizing (Obsidian's job).

## Transcript schema (observed)

Each line is a JSON event with `type`, most carrying `timestamp`, `cwd`, `sessionId`,
`gitBranch`, `version`, `isSidechain`. Relevant types:
- `user` — `message.content` is a **string** (a real typed prompt) OR a **list** (which is
  a `tool_result` turn → skip; not a prompt).
- `assistant` — `message.content` is a list of blocks: `text` (the reply), `thinking`
  (internal → skip), `tool_use` (`name` + `input`). `message.model` may be a real model id
  or `<synthetic>`.
- Metadata (`mode`, `permission-mode`, `attachment`, `file-history-snapshot`, `ai-title`,
  `system`, `last-prompt`, `queue-operation`, `summary`) → skipped.

The real project path comes from the events' `cwd` (no need to decode mangled dir names);
project name = last path component of `cwd`.

## Components (backend — new `src-tauri/src/commands/claude_sessions.rs`)

- **Model:**
  - `struct ClaudeSession { session_id, project, cwd, git_branch: Option<String>, model: Option<String>, start: DateTime<Local>, end: DateTime<Local>, turns: Vec<Turn> }`
  - `enum Turn { User(String), Assistant(String), Tool { name: String, summary: String } }`
- **`parse_session(jsonl: &str) -> Option<ClaudeSession>`** (pure, unit-tested): iterate
  lines; ignore `isSidechain`; collect turns; derive session_id/cwd/model/branch and
  first/last timestamp. Returns `None` if there are no renderable turns.
  - `tool_use` summary: pick the salient input field — `command` (Bash), `file_path`
    (Edit/Write/Read), `pattern` (Grep/Glob), else the tool name alone — truncated.
- **`render_claude_note(&ClaudeSession) -> String`** (pure, unit-tested): frontmatter
  (`type: claude`, `project`, `sessionId`, `model`, `gitBranch`, `tags: [slimrdm, claude,
  <project>]`, `start`, `end`) + a `## Conversation` body:
  - `### 🧑 User` blocks (prompt text)
  - `### 🤖 Claude` blocks (reply text)
  - `> 🔧 <Tool>: <summary>` lines for tool calls
- **`claude_note_stem(&ClaudeSession) -> String`** → `<YYYY-MM-DD> <first8ofUuid>`.
- **Vault writer:** reuse `logging::write_atomic`. Generalize the daily-index helper into
  `logging::upsert_daily_section(vault, date, section_title, link_stem)` and have both the
  SSH path (`"Sessions"`) and Claude path (`"Claude Sessions"`) call it. Must insert under
  the correct section header (not blindly at EOF) so the two sections don't cross-
  contaminate. `write_claude_note(vault, &session) -> io::Result<PathBuf>` writes
  `Claude/<project>/<stem>.md`.
- **Sync:** `sync_claude_sessions(claude_dir, vault, state_path) -> io::Result<SyncStats>`:
  walk top-level `*.jsonl`, skip unchanged (mtime matches state), parse + render + write +
  daily-link changed ones, persist updated state. `SyncStats { scanned, written }`.
- **Tauri command** `sync_claude_sessions_cmd(app)`: resolve `~/.claude/projects`, the
  vault from settings, and `app_data_dir/session-logs/claude-sync-state.json`; run the sync;
  return `SyncStats`. Registered in `lib.rs` and called once in `setup()` (best-effort,
  non-fatal).

## Frontend

- `LoggingSettings.ingestClaude: boolean` (default `false`); persisted; default merge in
  `load()`.
- Settings → Logging: an **"Ingest Claude Code sessions"** toggle + a **"Sync Claude
  sessions now"** button (calls the command, shows `written/scanned` result).
- `utils/tauri.ts`: `claude.sync()` wrapper.

## Note format

```markdown
---
type: claude
project: SlimRdm
sessionId: 2790ee50-1b9a-495c-98a2-8e69444ccb6d
model: claude-opus-4-8
gitBranch: main
tags: [slimrdm, claude, SlimRdm]
start: 2026-06-25T01:01:55
end: 2026-06-25T02:14:30
---

## Conversation

### 🧑 User

WHen I run tests on my cargo app…

### 🤖 Claude

Two separate questions here…

> 🔧 Bash: cargo test --lib
> 🔧 Edit: src/commands/logging.rs
```

## Error handling

Ingestion is **non-fatal**: a missing `~/.claude`, unreadable file, or malformed line is
skipped/logged, never crashes startup or the sync. Malformed JSON lines are ignored
individually.

## Testing

- `parse_session` — fixture-driven: string-user prompt, assistant text, tool_use summary,
  skipped thinking/tool_result/sidechain/metadata; empty transcript → `None`.
- `render_claude_note` — frontmatter fields + conversation ordering + tool markers.
- `upsert_daily_section` — two sections coexist; links land under the right header; dedupe.
- `sync_claude_sessions` — temp dir with two `*.jsonl`; second run with unchanged mtime
  writes nothing; a touched file re-renders.

## Related fix (folded in)

SSH logging currently **silently** no-ops when logging is on but no vault path is set.
Add a one-line guard/log + (frontend) a hint in Settings when `vaultPath` is empty but
logging is enabled.

## Implementation phases (TDD)

1. `parse_session` + `Turn`/`ClaudeSession` (fixture tests).
2. `render_claude_note` + `claude_note_stem`.
3. `upsert_daily_section` refactor (+ keep SSH `upsert_daily_index` green) and
   `write_claude_note`.
4. `sync_claude_sessions` + state file (temp-dir tests).
5. Tauri command + `lib.rs` startup + registration.
6. Frontend: settings toggle, sync button, `claude.sync()`; SSH no-vault hint.
```
