# SlimRDM Summarizer — Model Selector (design)

## Problem

The plugin's **Model tag** is a freehand text field. Typing a tag that Ollama doesn't
have installed (e.g. the old default `qwen2.5:14b` when only `qwen2.5-coder:14b`
exists) fails every generation with a "model not found" error and no summaries are
produced. Users have no in-plugin way to see which models are actually available.

## Goal

Let the user pick the model from a list of models **detected to exist** in their
Ollama instance, while never locking them out when Ollama is unreachable.

## Chosen behavior

A **dropdown of detected models plus a Refresh button**, degrading to the current
**freehand text field** when Ollama can't be reached. The dropdown is populated from
Ollama's `GET /api/tags` endpoint (the "check").

## Architecture

Three changes, following existing plugin structure and the `buildGenerateBody`
testable-seam pattern.

### 1. Detect installed models — `src/ollama.ts`

```ts
listModels(endpoint: string, timeoutMs: number): Promise<string[]>
```

- `GET {endpoint}/api/tags` via obsidian `requestUrl`, using the same
  `Promise.race` timeout pattern as `generate`.
- Throws on non-200 or network/timeout failure (caller decides how to degrade).
- Delegates response parsing to `parseModelTags`.

### 2. Pure parser seam — `src/ollama-body.ts`

```ts
parseModelTags(json: unknown): string[]
```

- Reads the `/api/tags` shape `{ models: [{ name: string, ... }, ...] }`.
- Returns model names, sorted ascending and de-duplicated.
- Defensive: missing/garbage/empty input → `[]` (never throws).
- `obsidian`-free so `node --test` can import it, exactly like `buildGenerateBody`.

### 3. Settings UI — `src/settings.ts`

Extract the Model control into its own method so it can re-render independently of
the sync `display()`:

```ts
private renderModelSetting(containerEl: HTMLElement): void
```

`display()` calls `renderModelSetting(containerEl)` where the Model text field is
today. The method:

1. Renders a transient "Checking models…" state and calls
   `listModels(s.endpoint, MODEL_LIST_TIMEOUT_MS)`.
2. **Success (≥1 model):** render an `addDropdown` of detected models and a
   **Refresh** button that re-invokes `renderModelSetting`. Selecting an option sets
   `s.model` and calls `saveSettings()`.
   - If the saved `s.model` is **not** in the detected list, prepend it as a selected
     option labeled `"<tag> (not installed)"` so the stored value is never silently
     changed — only flagged.
3. **Reachable but zero models:** fall back to the text field with the note
   "Ollama reachable, no models installed."
4. **Unreachable / timeout / non-200:** fall back to the existing freehand text field
   with a warning ("Couldn't reach Ollama — type a tag"), plus a Refresh button to
   retry.

Re-rendering swaps the control in place: `renderModelSetting` clears and rebuilds its
own `Setting` row(s) rather than the whole tab.

Constant: `MODEL_LIST_TIMEOUT_MS = 5000` — short enough that the settings tab never
visibly hangs.

## Data flow

```
open Settings tab
  → renderModelSetting(containerEl)
      → listModels(endpoint, 5000)
          → GET /api/tags → parseModelTags → string[]
      → success: dropdown (+ saved-but-missing option) | fail: text field
  → user picks / types → s.model = value → saveSettings()
  → Refresh button → renderModelSetting(containerEl)   // re-fetch, re-render
```

## Error handling / degradation

| Condition | Behavior |
|---|---|
| Ollama unreachable / timeout / non-200 | Text field + warning + Refresh (never locked out) |
| Reachable, no models installed | Text field + "no models installed" note |
| Saved model missing from list | Dropdown keeps it as `"<tag> (not installed)"`, still selected |
| Normal (≥1 model) | Dropdown of detected models + Refresh |

The generation path (`generate`) is unchanged; a bad tag still surfaces the existing
"model not found" Notice — the selector just makes that far less likely.

## Testing

- `parseModelTags` unit tests (in `test/ollama.test.ts`): normal payload → sorted
  names; `{ models: [] }` → `[]`; `null` / missing `models` / non-array / entries
  without `name` → `[]`; duplicates removed.
- Network and degradation paths are UI glue over `requestUrl`, verified manually
  (consistent with how `generate` itself is covered — only its pure body builder is
  unit-tested).
- Existing 23 tests stay green.

## Out of scope (YAGNI)

- Pulling / downloading models from the UI.
- Cross-session caching of the model list (fetch-on-open + Refresh is enough).
- Validating the model on every generate.

## Rollout

`npm test` → `npm run build` → redeploy `main.js` to the vault → reload plugin.
No `data.json` migration needed: `model` already exists and is preserved; the dropdown
only reads/writes that same field.
