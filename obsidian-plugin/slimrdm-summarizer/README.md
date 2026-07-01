# SlimRDM Summarizer (Obsidian plugin)

Summarizes the session notes SlimRDM writes — Claude Code sessions (primary) and SSH
sessions (optional) — and rolls each day's per-session summaries into the daily note's
`## Summary`, using a **local** Ollama model.

## Prerequisites

- [Ollama](https://ollama.com) running locally, with a model pulled:
  `ollama pull qwen2.5:14b`
- Obsidian 1.4+.

## Build & install

```bash
cd obsidian-plugin/slimrdm-summarizer
npm install
npm test         # runs the pure-logic unit tests
SLIMRDM_VAULT="/path/to/your/vault" npm run deploy
```

Then enable **SlimRDM Summarizer** in Obsidian → Settings → Community plugins.
(On Windows PowerShell: `$env:SLIMRDM_VAULT="C:\path\to\vault"; npm run deploy`.)

## Usage

- Runs on Obsidian startup (catch-up) if enabled in settings.
- Commands: *Summarize all unsummarized SlimRDM notes*, *Summarize current note*,
  *Re-summarize current note*, *Summarize today's daily note*, *Cancel summarization*.
- Ribbon: the sparkles icon runs catch-up.

Notes are considered done once they have a `summarizedAt` frontmatter stamp; re-running is
cheap. Transcripts are never modified — only a `## Summary` section and two frontmatter
stamps are added.

## Settings

Endpoint, model tag, timeout, temperature, run-on-startup + delay, scan folders,
summarize-SSH toggle, max transcript chars, and editable session/daily prompt templates.
