# SlimRDM Summarizer — Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick the summarizer model from a dropdown of models detected in their Ollama server, degrading to a freehand text field when Ollama is unreachable.

**Architecture:** A pure `parseModelTags` parser (in the obsidian-free `ollama-body.ts` seam) turns Ollama's `GET /api/tags` response into a sorted name list. A thin `listModels` wrapper in `ollama.ts` does the HTTP fetch with a timeout. The settings tab renders the Model control asynchronously via a re-runnable `renderModelSetting` method: dropdown + Refresh on success, text field on failure.

**Tech Stack:** TypeScript, esbuild bundle, Obsidian Plugin API (`Setting`, `requestUrl`), Node's built-in `node:test` runner.

## Global Constraints

- Plugin lives in `obsidian-plugin/slimrdm-summarizer/`; all paths below are relative to that directory.
- Build: `npm run build` (esbuild; strips types, does NOT type-check). Tests: `npm test` (`node --test`).
- `ollama-body.ts` MUST NOT import `obsidian` — it is the unit-testable seam. Test files import from `../src/ollama-body.ts` only.
- Follow the existing `buildGenerateBody` pattern: pure logic in `ollama-body.ts`, tested; HTTP glue in `ollama.ts`, not unit-tested.
- Settings persistence is always `s.<field> = value; await this.plugin.saveSettings();` — never introduce a new storage path.
- The stored `model` value must never be silently changed; an uninstalled saved tag is kept and flagged, not dropped.
- Model-list fetch timeout constant: `MODEL_LIST_TIMEOUT_MS = 5000`.

---

### Task 1: `parseModelTags` pure parser

**Files:**
- Modify: `src/ollama-body.ts` (append new exported function)
- Test: `test/ollama.test.ts` (append new tests; file already exists)

**Interfaces:**
- Consumes: nothing (pure function over already-parsed JSON).
- Produces: `parseModelTags(json: unknown): string[]` — sorted, de-duplicated Ollama model names; `[]` for any missing/malformed input (never throws). Consumed by `listModels` in Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `test/ollama.test.ts`:

```ts
import { buildGenerateBody, parseModelTags } from '../src/ollama-body.ts';

test('parseModelTags returns sorted, de-duplicated names', () => {
  const json = { models: [{ name: 'qwen2.5-coder:14b' }, { name: 'nomic-embed-text:latest' }, { name: 'qwen2.5-coder:14b' }] };
  assert.deepEqual(parseModelTags(json), ['nomic-embed-text:latest', 'qwen2.5-coder:14b']);
});

test('parseModelTags returns [] for empty model list', () => {
  assert.deepEqual(parseModelTags({ models: [] }), []);
});

test('parseModelTags returns [] for malformed or missing input', () => {
  assert.deepEqual(parseModelTags(null), []);
  assert.deepEqual(parseModelTags(undefined), []);
  assert.deepEqual(parseModelTags({}), []);
  assert.deepEqual(parseModelTags({ models: 'nope' }), []);
  assert.deepEqual(parseModelTags({ models: [{}, { size: 1 }, { name: '' }] }), []);
});
```

Note: the existing top of the file imports only `buildGenerateBody`. Replace that existing import line

```ts
import { buildGenerateBody } from '../src/ollama-body.ts';
```

with the combined import shown above (`buildGenerateBody, parseModelTags`). Do not add a second import line.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `parseModelTags` is not exported (`SyntaxError: ... does not provide an export named 'parseModelTags'` or the 3 new assertions error).

- [ ] **Step 3: Implement `parseModelTags`**

Append to `src/ollama-body.ts`:

```ts
/** Parse Ollama's GET /api/tags response into sorted, de-duplicated model names.
 *  Defensive: any missing/malformed input yields [] (never throws). */
export function parseModelTags(json: unknown): string[] {
  const models =
    json && typeof json === 'object'
      ? (json as { models?: unknown }).models
      : undefined;
  if (!Array.isArray(models)) return [];
  const names: string[] = [];
  for (const m of models) {
    if (m && typeof m === 'object') {
      const name = (m as { name?: unknown }).name;
      if (typeof name === 'string' && name.length > 0) names.push(name);
    }
  }
  return Array.from(new Set(names)).sort();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests (previous 23 + 4 new) green.

- [ ] **Step 5: Commit**

```bash
git add src/ollama-body.ts test/ollama.test.ts
git commit -m "feat(summarizer): parseModelTags for Ollama /api/tags response"
```

---

### Task 2: `listModels` HTTP wrapper

**Files:**
- Modify: `src/ollama.ts` (add import of `parseModelTags`; add `listModels` export)

**Interfaces:**
- Consumes: `parseModelTags` from Task 1.
- Produces: `listModels(endpoint: string, timeoutMs: number): Promise<string[]>` — resolves to detected model names, rejects on non-200 / network error / timeout. Consumed by `settings.ts` in Task 3.

No unit test: this is HTTP glue over obsidian's `requestUrl` (which cannot run under `node:test`), exactly like `generate`. Its only non-trivial logic — parsing — is covered by Task 1. Verification is a successful build.

- [ ] **Step 1: Update the import in `src/ollama.ts`**

Change line 2 from:

```ts
import { buildGenerateBody, type GenerateOptions } from './ollama-body.ts';
```

to:

```ts
import { buildGenerateBody, parseModelTags, type GenerateOptions } from './ollama-body.ts';
```

- [ ] **Step 2: Add the `listModels` function**

Append to `src/ollama.ts` (after the `generate` function):

```ts
export async function listModels(endpoint: string, timeoutMs: number): Promise<string[]> {
  const url = `${endpoint.replace(/\/$/, '')}/api/tags`;

  const req = requestUrl({ url, method: 'GET', throw: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Ollama request timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });

  try {
    const res = await Promise.race([req, timeout]);
    if (res.status !== 200) {
      throw new Error(`Ollama returned HTTP ${res.status}`);
    }
    return parseModelTags(res.json);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3: Verify the build succeeds**

Run: `npm run build`
Expected: `main.js` written, "Done in NNms", no errors.

- [ ] **Step 4: Confirm tests still pass**

Run: `npm test`
Expected: PASS — 27 tests, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/ollama.ts
git commit -m "feat(summarizer): listModels wrapper for GET /api/tags"
```

---

### Task 3: Settings model selector (dropdown + Refresh, text fallback)

**Files:**
- Modify: `src/settings.ts` (import `listModels`; add `MODEL_LIST_TIMEOUT_MS`; replace the "Model tag" text `Setting` with an async model container; add `renderModelSetting` and `renderModelTextFallback` methods)
- Modify: `manifest.json` and `package.json` (version `1.1.0` → `1.2.0`)

**Interfaces:**
- Consumes: `listModels(endpoint, timeoutMs)` from Task 2.
- Produces: user-facing settings behavior only; no exports other tasks depend on.

No unit test: obsidian `Setting`/DOM and `requestUrl` cannot run under `node:test`. Verified by build + manual check in Task 4.

- [ ] **Step 1: Update imports and add the timeout constant**

In `src/settings.ts`, change the first import line from:

```ts
import { App, PluginSettingTab, Setting } from 'obsidian';
```

to:

```ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import { listModels } from './ollama.ts';

const MODEL_LIST_TIMEOUT_MS = 5000;
```

- [ ] **Step 2: Replace the "Model tag" text field with an async model container**

In `display()`, delete this existing block:

```ts
    new Setting(containerEl)
      .setName('Model tag')
      .setDesc('Ollama model used for summaries, e.g. qwen2.5:14b.')
      .addText((t) =>
        t.setValue(s.model).onChange(async (v) => {
          s.model = v.trim();
          await this.plugin.saveSettings();
        }),
      );
```

and replace it with:

```ts
    // Model selector: async dropdown of detected models, text fallback when Ollama is down.
    const modelContainer = containerEl.createDiv();
    this.renderModelSetting(modelContainer);
```

- [ ] **Step 3: Add the `renderModelSetting` and `renderModelTextFallback` methods**

Add these two private methods to the `SlimrdmSummarizerSettingTab` class (e.g. directly after the `display()` method):

```ts
  private renderModelSetting(container: HTMLElement): void {
    container.empty();
    const s = this.plugin.settings;

    new Setting(container).setName('Model').setDesc('Checking installed models…');

    listModels(s.endpoint, MODEL_LIST_TIMEOUT_MS)
      .then((models) => {
        container.empty();
        if (models.length === 0) {
          this.renderModelTextFallback(
            container,
            'Ollama reachable, but no models are installed. Pull one (ollama pull <tag>), then Refresh.',
          );
          return;
        }
        const installed = new Set(models);
        const options = installed.has(s.model) ? models : [s.model, ...models];
        const setting = new Setting(container)
          .setName('Model')
          .setDesc('Ollama model used for summaries. Detected from your Ollama server.');
        setting.addDropdown((d) => {
          for (const m of options) {
            d.addOption(m, installed.has(m) ? m : `${m} (not installed)`);
          }
          d.setValue(s.model).onChange(async (v) => {
            s.model = v;
            await this.plugin.saveSettings();
          });
        });
        setting.addExtraButton((b) =>
          b
            .setIcon('refresh-cw')
            .setTooltip('Refresh model list')
            .onClick(() => this.renderModelSetting(container)),
        );
      })
      .catch(() => {
        this.renderModelTextFallback(
          container,
          "Couldn't reach Ollama — type a model tag manually, then Refresh once it's running.",
        );
      });
  }

  private renderModelTextFallback(container: HTMLElement, warning: string): void {
    const s = this.plugin.settings;
    const setting = new Setting(container)
      .setName('Model')
      .setDesc(warning)
      .addText((t) =>
        t.setValue(s.model).onChange(async (v) => {
          s.model = v.trim();
          await this.plugin.saveSettings();
        }),
      );
    setting.addExtraButton((b) =>
      b
        .setIcon('refresh-cw')
        .setTooltip('Retry detecting models')
        .onClick(() => this.renderModelSetting(container)),
    );
  }
```

- [ ] **Step 4: Bump the plugin version**

In `manifest.json` change `"version": "1.1.0",` → `"version": "1.2.0",`.
In `package.json` change `"version": "1.1.0",` → `"version": "1.2.0",`.

- [ ] **Step 5: Verify build and tests**

Run: `npm run build && npm test`
Expected: build writes `main.js` with no errors; 27 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts manifest.json package.json
git commit -m "feat(summarizer): model dropdown from detected Ollama models (v1.2.0)"
```

---

### Task 4: Deploy and manually verify

**Files:** none (deploy copies the gitignored `main.js`; no commit).

- [ ] **Step 1: Redeploy the built plugin to the vault**

```bash
cp main.js manifest.json styles.css "/c/Users/KingKarl/Desktop/slimrdm-test-vault/.obsidian/plugins/slimrdm-summarizer/"
```

- [ ] **Step 2: Reload the plugin in Obsidian**

In Obsidian → Community plugins → toggle **SlimRDM Summarizer** off, then on (or restart Obsidian). Do this without opening the plugin's settings tab first.

- [ ] **Step 3: Verify the dropdown (Ollama running)**

Open Settings → SlimRDM Summarizer. Expected: the **Model** row is a dropdown listing your installed models (e.g. `qwen2.5-coder:14b`, `qwen2.5-coder:7b`, `nomic-embed-text:latest`) with your saved value selected, plus a Refresh (↻) button. Confirm `ollama ps`/`ollama list` tags match the dropdown entries.

- [ ] **Step 4: Verify the text fallback (Ollama stopped)**

Stop Ollama (or set the endpoint to a bad port), click Refresh. Expected: the row degrades to a text field with the "Couldn't reach Ollama" warning and a retry button — you are not locked out. Restart Ollama, click Refresh, and the dropdown returns.

- [ ] **Step 5: Verify saved-but-uninstalled handling**

Temporarily set Model (via the text fallback) to a tag you don't have (e.g. `qwen2.5:14b`), reopen settings with Ollama running. Expected: the dropdown keeps that value selected, labeled `qwen2.5:14b (not installed)`, and does not silently switch it.

---

## Self-Review

**Spec coverage:**
- Detect models via `GET /api/tags` → Task 1 (`parseModelTags`) + Task 2 (`listModels`). ✓
- Dropdown + Refresh on success → Task 3 `renderModelSetting`. ✓
- Text fallback when unreachable → Task 3 `renderModelTextFallback` + Task 4 Step 4. ✓
- Reachable but zero models → Task 3 `.then` empty-list branch. ✓
- Saved model missing from list kept + flagged → Task 3 `options`/label logic + Task 4 Step 5. ✓
- 5 s timeout constant → Task 3 `MODEL_LIST_TIMEOUT_MS`. ✓
- `parseModelTags` unit tests (sorted, empty, malformed, dedupe) → Task 1. ✓
- Existing tests stay green → Tasks 2 & 3 Step verifications. ✓
- No model pull / no caching / no per-generate validation (out of scope) → nothing added. ✓
- Rollout (build, deploy, reload) → Task 4. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type consistency:** `listModels(endpoint: string, timeoutMs: number): Promise<string[]>` and `parseModelTags(json: unknown): string[]` are used identically in the tasks that consume them; `renderModelSetting(container: HTMLElement)` / `renderModelTextFallback(container, warning)` names match across Steps 2–3. ✓
