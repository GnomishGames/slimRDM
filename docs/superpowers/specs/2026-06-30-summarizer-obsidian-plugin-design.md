# SlimRDM Summarizer — Obsidian Plugin — Design

**Date:** 2026-06-30
**Status:** Draft, pending user review
**Follows:** `2026-06-30-session-logging-obsidian-design.md` (this fills the `## Summary`
section that logging deliberately leaves empty)

## Summary

An Obsidian community plugin that summarizes the session notes SlimRDM writes, using a
**locally running Qwen model via Ollama** (`http://localhost:11434`). SlimRDM captures and
structures; this plugin adds the summarization layer that the logging design explicitly
delegated to Obsidian. It writes a `## Summary` into each session note and rolls those up
into the day's empty `## Summary` in the daily index.

Guiding ethos (inherited): **local-only** (no cloud LLM, all inference on-device via
Ollama), **non-destructive** (only writes a Summary section + a few frontmatter stamps;
never touches transcripts), **safe to interrupt** (sequential, idempotent, resumable).

## Priorities

- **Claude session notes (`type: claude`) are the primary target** — most valuable to
  summarize.
- **SSH session notes (`type: ssh`) are nice-to-have** — supported by the same machinery,
  processed after Claude notes.
- **Daily rollup** ties the day together from the per-session summaries.

## Scope

**In scope (v1):**
- An Obsidian plugin (TypeScript, esbuild) with source in the SlimRDM repo, built into the
  vault's plugins folder.
- Per-session summaries for Claude notes and SSH notes.
- Daily-note rollup built from that day's per-session summaries.
- Run-on-Obsidian-startup catch-up (the practical replacement for a 2am cron, since the
  machine sleeps overnight), plus manual command-palette triggers.
- Idempotent, sequential background processing with a visible progress indicator and a
  cancel command.
- Configurable Ollama endpoint, model tag, prompts, scan folders, and truncation limit.

**Out of scope (v1):**
- Any change to SlimRDM (Rust/React) itself. The note format is already in place.
- Semantic search / embeddings / RAG over the vault.
- Streaming token display; we request a single non-streamed completion.
- Scheduling independent of Obsidian (OS Task Scheduler). Considered and rejected: the PC
  sleeps at 2am, and startup catch-up covers the real need without a second artifact.
- Multi-model routing, cloud fallback.

## Why an Obsidian plugin (not SlimRDM, not a standalone script)

- Keeps SlimRDM LLM-free, honoring its stated "capture only" ethos.
- Runs where the notes live; can re-run, re-summarize, and be triggered by hand.
- Reuses Obsidian's metadata cache to find notes by frontmatter rather than fragile paths.

## Architecture

### Project layout

```
obsidian-plugin/slimrdm-summarizer/
  manifest.json          # Obsidian plugin manifest (id, name, version, minAppVersion)
  package.json           # dev deps: obsidian, esbuild, typescript, a tiny test runner
  esbuild.config.mjs     # bundles src/main.ts → main.js (CJS, external: obsidian)
  tsconfig.json
  styles.css             # minimal (status bar / notice styling if needed)
  src/
    main.ts              # plugin entry: lifecycle, commands, startup catch-up, settings tab
    settings.ts          # settings interface + defaults + SettingTab UI
    ollama.ts            # thin HTTP client for POST /api/generate
    notes.ts             # PURE helpers: classify note, detect summarized, insert/replace
                         #   the ## Summary section, extract transcript, build daily input
    prompts.ts           # PURE: default prompt templates + prompt assembly
    summarizer.ts        # orchestration: queue, per-session pass, daily pass, cancel
  test/
    notes.test.ts        # unit tests for notes.ts (pure)
    prompts.test.ts      # unit tests for prompts.ts (pure)
    run.mjs              # node-based test runner (no Obsidian needed)
```

Build output (`main.js`, `manifest.json`, `styles.css`) is copied to
`<vault>/.obsidian/plugins/slimrdm-summarizer/`. A dev npm script can copy on build; the
vault path is a local, machine-specific value kept out of the repo (documented in README,
optionally via an env var in the build script).

### How notes are identified (Obsidian metadata cache, not paths)

`app.metadataCache.getFileCache(file).frontmatter` gives typed frontmatter without parsing
files by hand. Classification:

- **Claude session:** `type: claude` → summarize the `## Conversation` body.
- **SSH session:** `type: ssh` → summarize the `## Transcript` fenced block.
- **Daily:** `tags` contains `daily` (and `slimrdm`) with a `## Summary` section → rollup.

Scan is limited to configured folders (defaults `Claude/`, `SlimRDM/`, `Daily/`) for speed,
but classification is by frontmatter so a moved note still works.

### Data flow

```
Obsidian startup
   └─ after `startupDelayMs`, if runOnStartup:
        summarizer.runCatchUp():
          pass 1 (sessions):  Claude notes first, then SSH notes
             for each note lacking `summarizedAt`:
                text = extract body (notes.ts)
                if too long → truncate to maxChars (notes.ts)
                summary = ollama.generate(model, buildSessionPrompt(text))   // sequential
                note = insertSummarySection(note, summary)                    // notes.ts
                stamp frontmatter: summarizedAt, summaryModel
          pass 2 (daily):
             for each daily note with empty ## Summary:
                inputs = collectDaySessionSummaries(daily, cache)             // notes.ts
                summary = ollama.generate(model, buildDailyPrompt(inputs))
                note = replaceSummarySection(note, summary)                   // notes.ts
                stamp frontmatter: summarizedAt, summaryModel

Manual commands call the same summarizer entry points on one note or the whole vault.
```

Processing is **strictly sequential** (one Ollama request at a time) to avoid overloading
a local 14B model. A status-bar item shows `Summarizing N/M…`; a "Cancel summarization"
command flips a flag the loop checks between notes.

### Components

- **`ollama.ts`** — `generate(opts): Promise<string>`. `POST {endpoint}/api/generate` with
  `{ model, prompt, stream:false, options:{ temperature } }`. Uses Obsidian's `requestUrl`
  (bypasses CORS). Throws on non-200, network error, or empty `response`. A configurable
  timeout aborts a hung request.
- **`notes.ts`** (pure, unit-tested) — no Obsidian imports; operates on strings/plain data:
  - `classify(frontmatter): 'claude' | 'ssh' | 'daily' | null`
  - `isSummarized(frontmatter): boolean` (`summarizedAt` present)
  - `extractSessionBody(content, type): string` (Conversation body / Transcript code block)
  - `truncate(text, maxChars): string` (keep head+tail with an elision marker)
  - `insertSummarySection(content, summary): string` (session notes — inserts `## Summary`
    right after frontmatter, above the first `##`; replaces if already present)
  - `replaceSummarySection(content, summary): string` (daily notes — fills the existing
    empty `## Summary`, replacing the placeholder comment)
  - `stampFrontmatter(content, {summarizedAt, summaryModel}): string`
  - `dailyEmpty(content): boolean` (Summary section holds only the placeholder/whitespace)
  - `collectDaySessionSummaries(dailyContent): string[]` (parse `[[wikilinks]]` under the
    Sessions / Claude Sessions headings so the daily pass can look them up)
- **`prompts.ts`** (pure, unit-tested) — default templates + `buildSessionPrompt(type,
  text)` and `buildDailyPrompt(perSessionSummaries)`. Templates are overridable in settings
  with `{{content}}` / `{{summaries}}` placeholders.
- **`summarizer.ts`** — orchestration + progress + cancel; the only module wiring Obsidian
  `Vault`/`MetadataCache` I/O to the pure helpers and `ollama.ts`.
- **`settings.ts` / `main.ts`** — settings model, SettingTab UI, command registration,
  `onload` startup catch-up.

## Note format changes

**Claude / SSH session note — after summarization:**
```markdown
---
type: claude
project: SlimRdm
sessionId: abc123def456
model: claude-opus-4-8
tags: [slimrdm, claude, SlimRdm]
start: 2026-06-30T14:02:11
end: 2026-06-30T14:37:44
summarizedAt: 2026-06-30T21:05:00
summaryModel: qwen2.5:14b
---

## Summary

<one short paragraph + 2–5 bullets of what happened / decisions / outcomes>

## Conversation
...
```

- `## Summary` is inserted immediately after frontmatter and **above** the existing first
  section (`## Conversation` / `## Transcript`); transcripts are never modified.
- Re-summarize replaces the existing `## Summary` in place (does not stack).

**Daily note — after rollup:** the placeholder in the `## Summary` section (`<!-- left
empty for your Obsidian LLM plugin to fill -->`) is replaced with the generated rollup; the
`## Sessions` / `## Claude Sessions` link lists are untouched.

## Idempotency & the startup catch-up

- A note is "done" when it has a `summarizedAt` frontmatter stamp. Catch-up and the
  "summarize all" command skip stamped notes; "re-summarize current note" ignores the stamp.
- Ordering: **Claude notes → SSH notes → daily rollups**, so the daily pass can consume
  fresh per-session summaries.
- Because the machine sleeps at 2am, the startup catch-up (after `startupDelayMs`, default
  ~5s so launch isn't janky) is the primary automatic path. It's resumable: interrupt it,
  and the next launch picks up the unstamped remainder.
- Runtime is unknown and possibly long on a 14B model; hence sequential + status-bar
  progress + cancel, and the truncation limit to bound per-request cost. These knobs let us
  tune later without redesign.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Ollama endpoint | `http://localhost:11434` | |
| Model tag | `qwen2.5:14b` | changeable anytime |
| Request timeout (s) | `300` | a 14B rollup can be slow |
| Temperature | `0.3` | terse, factual summaries |
| Run on startup | `true` | the catch-up path |
| Startup delay (ms) | `5000` | avoid launch jank |
| Scan folders | `Claude, SlimRDM, Daily` | classification is still by frontmatter |
| Summarize SSH notes | `true` | lets you disable the nice-to-have |
| Max transcript chars | `12000` | truncate before sending |
| Session prompt template | (built-in) | `{{content}}` placeholder |
| Daily prompt template | (built-in) | `{{summaries}}` placeholder |

## Error handling

- Ollama unreachable / timeout / non-200 / empty response → `new Notice(...)`, note left
  **unstamped** (retried next run), loop continues to the next note. Never throws into
  Obsidian.
- A note missing its expected section is skipped with a console warning, not stamped.
- Cancel sets a flag checked between notes; the in-flight request is allowed to finish (or
  aborts on timeout).

## Testing

- **Unit (pure, no Obsidian) via `test/run.mjs`:**
  - `notes.ts`: classify each frontmatter shape; detect summarized; extract Conversation
    body and Transcript code block; truncate head+tail; insert Summary above first section;
    replace existing Summary (no stacking); replace the daily placeholder; parse
    `[[wikilinks]]` for the daily rollup; `dailyEmpty` true/false.
  - `prompts.ts`: session vs daily prompt assembly; placeholder substitution; template
    override.
- **Manual (real vault + Ollama):** enable plugin, point at the vault, run "Summarize all",
  verify Claude notes get a Summary above the Conversation, SSH notes above the Transcript,
  the daily `## Summary` fills from per-session summaries, restart re-runs cheaply (all
  skipped), and Ollama-down shows a Notice without corrupting notes.

## Implementation phases

1. **Scaffold:** plugin manifest/package/esbuild/tsconfig, empty `main.ts` that loads,
   test runner wired.
2. **Pure core (TDD):** `notes.ts` + `prompts.ts` with full unit tests.
3. **Ollama client:** `ollama.ts` against the local endpoint.
4. **Orchestration:** `summarizer.ts` — Claude-first per-session pass, then SSH, then daily
   rollup; sequential queue, progress, cancel.
5. **Wiring:** commands, startup catch-up, settings tab; build-into-vault script.
6. **Polish:** truncation tuning, prompt tuning against real sessions, README (install/build
   + Ollama prerequisites).
