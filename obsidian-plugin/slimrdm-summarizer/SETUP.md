# SlimRDM Session Summaries — Setup Guide

This guide sets up the full pipeline that turns your SlimRDM sessions into
summarized notes in Obsidian, using a **local** LLM (Ollama/Qwen) — nothing
leaves your machine.

```
SlimRDM  ──(captures sessions)──▶  Obsidian vault (markdown notes)
                                          │
                    SlimRDM Summarizer plugin ──(local Ollama)──▶  fills "## Summary"
```

There are three moving parts. Set them up in this order.

1. **Ollama** — runs the local model that writes the summaries.
2. **SlimRDM logging** — writes session notes into your vault.
3. **SlimRDM Summarizer plugin** — reads those notes and summarizes them in Obsidian.

You can set up #1 and #3 and use the plugin even before #2 — but there will be
nothing to summarize until SlimRDM starts writing notes into the vault.

---

## Part 1 — Ollama (the local model)

1. Install Ollama: https://ollama.com
2. Pull a Qwen model (the plugin default is `qwen2.5:14b`, ~9 GB):
   ```
   ollama pull qwen2.5:14b
   ```
   A smaller option if that's too heavy: `ollama pull qwen2.5:7b`.
3. Confirm what you have and note the **exact tag** — you'll need it in Part 5:
   ```
   ollama list
   ```
4. Sanity-check the server is answering (it listens on `http://localhost:11434`):
   ```
   curl http://localhost:11434/api/generate -d "{\"model\":\"qwen2.5:14b\",\"prompt\":\"Say hi in 5 words.\",\"stream\":false}"
   ```
   You should get JSON with a non-empty `"response"`. If you get
   `model '...' not found`, the tag doesn't match — go by what `ollama list`
   shows.

Ollama must be running whenever summaries are generated (it normally runs in the
background after install).

---

## Part 2 — SlimRDM logging (writes the notes)

> **Requires a SlimRDM build that has the logging feature.** Session logging and
> Claude-session ingest are recent additions. If your installed/release SlimRDM
> has **no "Logging" section** in Settings, you're on an older build — run the
> dev build from the repo instead:
> ```
> source ~/.cargo/env && npm run tauri dev
> ```
> (See "Am I on the right SlimRDM build?" below.)

In SlimRDM → **Settings → Logging**:

- **Vault path** — set this to your Obsidian vault's **root folder** (the folder
  you open in Obsidian), e.g. `C:\Users\You\Documents\MyVault`.
- **Enable session logging** (global toggle) and, if you use Claude Code,
  **ingest Claude sessions**.
- Optional: add **redaction patterns** (one regex per line) to mask secrets.

Per-connection and per-group "Log sessions" tri-state (Inherit / On / Off) lets
you control which SSH sessions are captured.

Once enabled, SlimRDM writes notes into the vault like this:

```
<vault>/SlimRDM/<YYYY>/<MM-DD>/<date host (HH-MM)>.md   ← SSH sessions
<vault>/Claude/<project>/<date shortid>.md              ← Claude Code sessions
<vault>/Daily/<YYYY-MM-DD>.md                            ← daily index (empty ## Summary)
```

The `## Summary` sections it leaves empty are exactly what the plugin fills.

---

## Part 3 — Build & deploy the plugin

From the repo:

```
cd obsidian-plugin/slimrdm-summarizer
npm install
npm test        # optional: 21 unit tests should pass
npm run build   # produces main.js
```

Deploy it into your vault. **`SLIMRDM_VAULT` must be the vault ROOT** — the same
folder you set in Part 2 and open in Obsidian:

- PowerShell:
  ```
  $env:SLIMRDM_VAULT="C:\Users\You\Documents\MyVault"; npm run deploy
  ```
- bash:
  ```
  SLIMRDM_VAULT="/c/Users/You/Documents/MyVault" npm run deploy
  ```

It should print `Deployed slimrdm-summarizer to ...\.obsidian\plugins\slimrdm-summarizer`.

> ⚠️ **Most common mistake:** pointing `SLIMRDM_VAULT` at a **subfolder** instead
> of the vault root. Obsidian only loads plugins from the `.obsidian` folder of
> the vault you actually open. If you deploy into a subfolder, it creates a stray
> `.obsidian` there and the plugin never shows up. Verify the files landed in the
> right place:
> ```
> <vault>/.obsidian/plugins/slimrdm-summarizer/
>    ├── main.js
>    ├── manifest.json
>    └── styles.css
> ```

---

## Part 4 — Enable it in Obsidian

1. **Settings → Community plugins.** If you see "Restricted mode is on," click
   **Turn on community plugins**.
2. This plugin is **not published to the community catalog**, so it will **not**
   appear in **Browse**. Look in the **Installed plugins** section on that same
   page.
3. Click the 🔄 **refresh** icon (or fully quit and reopen Obsidian).
   **SlimRDM Summarizer** appears in the Installed list — toggle it **on**.

---

## Part 5 — Configure the plugin

Open **Settings → SlimRDM Summarizer** and check:

| Setting | Default | Notes |
|---|---|---|
| Ollama endpoint | `http://localhost:11434` | |
| Model tag | `qwen2.5:14b` | **Set to whatever `ollama list` shows.** |
| Request timeout (s) | `300` | A 14B model can be slow. |
| Temperature | `0.3` | Terse, factual summaries. |
| Run on startup | `true` | Summarizes new notes shortly after Obsidian opens. |
| Startup delay (ms) | `5000` | Grace period so launch isn't janky. |
| Scan folders | `Claude, SlimRDM, Daily` | Matches Part 2's layout. |
| Summarize SSH sessions | `true` | Claude sessions are always summarized; SSH is optional. |
| Max transcript chars | `12000` | Long transcripts are truncated before sending. |
| Session / Daily prompt | built-in | Editable; `{{content}}` / `{{summaries}}` placeholders. |

---

## Part 6 — Use it

- **Automatic:** it runs on Obsidian startup (catch-up), summarizing any notes
  that don't yet have a summary. This is the intended everyday path.
- **Manual (Command palette / ribbon 🌟):**
  - *Summarize all unsummarized SlimRDM notes*
  - *Summarize current note*
  - *Re-summarize current note (ignore stamp)*
  - *Summarize today's daily note*
  - *Cancel summarization*

What you'll see: each session note gains a `## Summary` above its transcript, and
the daily note's `## Summary` fills from that day's per-session summaries. A note
is marked done with a `summarizedAt` stamp in its frontmatter, so re-runs skip it
and are cheap. Progress shows in the status bar.

---

## Am I on the right SlimRDM build?

The logging feature only exists in recent builds. Quick checks:

- **In the app:** Settings has a **Logging** section. If it's missing, you're on
  an older release.
- **Run the dev build** (always has the latest from the repo):
  ```
  source ~/.cargo/env && npm run tauri dev
  ```
- Alternatively, build a fresh release from the current `main` branch.

The Obsidian plugin itself is independent of the SlimRDM app version — it works on
any notes that follow the layout above. But without a logging-capable SlimRDM,
nothing populates the vault for it to summarize.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Plugin not in **Browse** | Expected — it's not published. Look under **Installed plugins**. |
| Plugin missing from **Installed** | Files deployed to a subfolder, not the vault root (see Part 3 warning); or community plugins still restricted; or you didn't refresh/restart. |
| `model '...' not found` | Tag mismatch. Run `ollama list` and set the plugin's Model tag to match, or `ollama pull <tag>`. |
| "Ollama request timed out" / connection errors | Ollama isn't running, or the endpoint is wrong. Start Ollama; verify with the Part 1 curl. |
| Nothing gets summarized | No session notes in the vault yet — SlimRDM logging not enabled, or its vault path differs from where the plugin looks. Confirm both point to the same vault root. |
| A note stays unsummarized after a run | The model call failed (a Notice will say why); the note is intentionally left unstamped for retry. Fix Ollama and run again. |
| No **Logging** section in SlimRDM | You're on an older release — run the dev build (see above). |
