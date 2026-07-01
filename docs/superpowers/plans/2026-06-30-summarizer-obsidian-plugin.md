# SlimRDM Summarizer (Obsidian Plugin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Obsidian plugin that summarizes SlimRDM's session notes (Claude Code sessions first, SSH sessions second) and rolls them up into the daily note, using a local Qwen model via Ollama.

**Architecture:** A standalone TypeScript Obsidian plugin whose source lives in the SlimRDM repo under `obsidian-plugin/slimrdm-summarizer/` and builds (esbuild) into the vault's plugins folder. Pure logic (note parsing/section editing, prompt assembly) lives in Obsidian-free modules that are unit-tested with Node's built-in test runner; the thin Obsidian/HTTP layer (vault I/O, `requestUrl` to Ollama, commands, settings) is verified manually against the real vault + Ollama.

**Tech Stack:** TypeScript, esbuild, Obsidian Plugin API (`requestUrl`, `Vault`, `MetadataCache`), Node 26 built-in test runner (`node --test`, native type stripping), Ollama HTTP API (`POST /api/generate`).

## Global Constraints

- The plugin never modifies session transcripts/conversations — it only adds a `## Summary` section and `summarizedAt` / `summaryModel` frontmatter stamps.
- All inference is local via Ollama at a configurable endpoint (default `http://localhost:11434`); no cloud calls, no non-dev dependencies bundled.
- Ollama requests are **strictly sequential** (one at a time) and requested with `stream: false`.
- A note is "done" iff its frontmatter has a `summarizedAt` stamp; catch-up and "summarize all" skip stamped notes; "re-summarize" ignores the stamp.
- Processing order for catch-up: **Claude session notes → SSH session notes → daily rollups.**
- Default model tag: `qwen2.5:14b` (user-changeable in settings).
- Pure modules (`src/notes.ts`, `src/prompts.ts`) must import nothing from `obsidian` so they run under `node --test`. `src/prompts.ts` may `import type` from `src/notes.ts` (type-only, erased at runtime).
- Errors (Ollama unreachable/timeout/non-200/empty) surface via `new Notice(...)`, leave the note unstamped for retry, and never throw into Obsidian.
- Node ≥ 22.6 required for tests (native `.ts` type stripping). Dev machine has Node 26.

---

### Task 1: Scaffold the plugin project

**Files:**
- Create: `obsidian-plugin/slimrdm-summarizer/manifest.json`
- Create: `obsidian-plugin/slimrdm-summarizer/package.json`
- Create: `obsidian-plugin/slimrdm-summarizer/tsconfig.json`
- Create: `obsidian-plugin/slimrdm-summarizer/esbuild.config.mjs`
- Create: `obsidian-plugin/slimrdm-summarizer/styles.css`
- Create: `obsidian-plugin/slimrdm-summarizer/scripts/deploy.mjs`
- Create: `obsidian-plugin/slimrdm-summarizer/.gitignore`
- Create: `obsidian-plugin/slimrdm-summarizer/src/main.ts` (minimal placeholder)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a buildable plugin skeleton. `npm run build` emits `main.js`; `npm test` runs the Node test runner (no tests yet); `npm run deploy` copies build output to `$SLIMRDM_VAULT/.obsidian/plugins/slimrdm-summarizer/`.

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "id": "slimrdm-summarizer",
  "name": "SlimRDM Summarizer",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Summarizes SlimRDM session notes (Claude Code + SSH) and daily rollups using a local Ollama model.",
  "author": "GnomishGames",
  "isDesktopOnly": true
}
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "slimrdm-summarizer",
  "version": "1.0.0",
  "description": "Summarize SlimRDM session notes into Obsidian using a local Ollama model.",
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs production",
    "dev": "node esbuild.config.mjs",
    "test": "node --test test/notes.test.ts test/prompts.test.ts",
    "deploy": "npm run build && node scripts/deploy.mjs"
  },
  "keywords": ["obsidian", "ollama", "slimrdm"],
  "license": "MIT",
  "devDependencies": {
    "esbuild": "^0.23.0",
    "obsidian": "^1.5.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "esModuleInterop": true,
    "lib": ["ES2020", "DOM"],
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Create `esbuild.config.mjs`**

```js
import esbuild from 'esbuild';

const prod = process.argv.includes('production');

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  outfile: 'main.js',
  sourcemap: prod ? false : 'inline',
  minify: prod,
  logLevel: 'info',
});
```

- [ ] **Step 5: Create `styles.css`**

```css
/* SlimRDM Summarizer — no custom styles needed yet. */
```

- [ ] **Step 6: Create `scripts/deploy.mjs`**

```js
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const vault = process.env.SLIMRDM_VAULT;
if (!vault) {
  console.error('Set SLIMRDM_VAULT to your Obsidian vault path before deploying.');
  process.exit(1);
}

const dest = join(vault, '.obsidian', 'plugins', 'slimrdm-summarizer');
mkdirSync(dest, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
  cpSync(f, join(dest, f));
}
console.log('Deployed slimrdm-summarizer to', dest);
```

- [ ] **Step 7: Create `.gitignore`**

```gitignore
node_modules/
main.js
main.js.map
```

- [ ] **Step 8: Create minimal `src/main.ts`**

```ts
import { Plugin } from 'obsidian';

export default class SlimrdmSummarizerPlugin extends Plugin {
  async onload() {
    console.log('SlimRDM Summarizer loaded');
  }
}
```

- [ ] **Step 9: Install deps and verify the build**

Run: `cd obsidian-plugin/slimrdm-summarizer && npm install && npm run build`
Expected: esbuild logs success and `main.js` exists in the plugin dir.

- [ ] **Step 10: Verify the test runner wiring (no tests yet)**

Run: `cd obsidian-plugin/slimrdm-summarizer && node --test test/ ; echo "exit=$?"`
Expected: Node reports no test files found (that's fine — real command comes with Task 2). This just confirms `node --test` is available.

- [ ] **Step 11: Commit**

```bash
git add obsidian-plugin/slimrdm-summarizer
git commit -m "feat(summarizer): scaffold Obsidian plugin project"
```

---

### Task 2: Pure note helpers (`notes.ts`) — TDD

**Files:**
- Create: `obsidian-plugin/slimrdm-summarizer/src/notes.ts`
- Test: `obsidian-plugin/slimrdm-summarizer/test/notes.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no Obsidian imports).
- Produces:
  - `type NoteType = 'claude' | 'ssh' | 'daily'`
  - `classify(fm: Record<string, unknown> | undefined): NoteType | null`
  - `isSummarized(fm: Record<string, unknown> | undefined): boolean`
  - `extractSessionBody(content: string, type: NoteType): string`
  - `extractSummarySection(content: string): string | null`
  - `dailyEmpty(content: string): boolean`
  - `collectDaySessionLinks(content: string): string[]`
  - `truncate(text: string, maxChars: number): string`
  - `upsertSummarySection(content: string, summary: string): string`
  - `stampFrontmatter(content: string, stamps: Record<string, string>): string`

- [ ] **Step 1: Write the failing tests**

Create `test/notes.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, isSummarized, extractSessionBody, extractSummarySection,
  dailyEmpty, collectDaySessionLinks, truncate, upsertSummarySection, stampFrontmatter,
} from '../src/notes.ts';

const CLAUDE = `---
type: claude
tags: [slimrdm, claude]
---

## Conversation

### 🧑 User

hello

### 🤖 Claude

hi there
`;

const SSH = `---
type: ssh
---

## Transcript

\`\`\`text
echo hi
hi
\`\`\`
`;

const DAILY = `---
date: 2026-06-30
tags: [slimrdm, daily]
---

## Summary

<!-- left empty for your Obsidian LLM plugin to fill -->

## Sessions

- [[2026-06-30 web01 (14-02)]]

## Claude Sessions

- [[2026-06-30 abc123de]]
`;

test('classify by frontmatter type and tags', () => {
  assert.equal(classify({ type: 'claude' }), 'claude');
  assert.equal(classify({ type: 'ssh' }), 'ssh');
  assert.equal(classify({ tags: ['slimrdm', 'daily'] }), 'daily');
  assert.equal(classify({ tags: 'slimrdm, daily' }), 'daily');
  assert.equal(classify({}), null);
  assert.equal(classify(undefined), null);
});

test('isSummarized reflects summarizedAt', () => {
  assert.equal(isSummarized({ summarizedAt: '2026-06-30T21:00:00' }), true);
  assert.equal(isSummarized({}), false);
  assert.equal(isSummarized(undefined), false);
});

test('extractSessionBody pulls Conversation for claude', () => {
  const b = extractSessionBody(CLAUDE, 'claude');
  assert.match(b, /hello/);
  assert.match(b, /hi there/);
  assert.doesNotMatch(b, /## Conversation/);
});

test('extractSessionBody pulls fenced transcript for ssh', () => {
  assert.equal(extractSessionBody(SSH, 'ssh'), 'echo hi\nhi');
});

test('upsertSummarySection inserts above first heading for session notes', () => {
  const out = upsertSummarySection(CLAUDE, 'A summary.');
  const sIdx = out.indexOf('## Summary');
  const cIdx = out.indexOf('## Conversation');
  assert.ok(sIdx > 0 && sIdx < cIdx, out);
  assert.match(out, /## Summary\n\nA summary\./);
});

test('upsertSummarySection replaces existing summary (no stacking)', () => {
  const first = upsertSummarySection(CLAUDE, 'First.');
  const second = upsertSummarySection(first, 'Second.');
  assert.equal(second.match(/## Summary/g)?.length, 1);
  assert.match(second, /Second\./);
  assert.doesNotMatch(second, /First\./);
});

test('dailyEmpty true when only placeholder, false after fill', () => {
  assert.equal(dailyEmpty(DAILY), true);
  assert.equal(dailyEmpty(upsertSummarySection(DAILY, 'Real content.')), false);
});

test('upsertSummarySection on daily preserves session lists', () => {
  const filled = upsertSummarySection(DAILY, 'Real content.');
  assert.match(filled, /## Sessions/);
  assert.match(filled, /\[\[2026-06-30 abc123de\]\]/);
  assert.equal(filled.match(/## Summary/g)?.length, 1);
});

test('extractSummarySection returns filled body', () => {
  const filled = upsertSummarySection(CLAUDE, 'The summary.');
  assert.equal(extractSummarySection(filled), 'The summary.');
});

test('collectDaySessionLinks reads both session headings in order', () => {
  assert.deepEqual(collectDaySessionLinks(DAILY), [
    '2026-06-30 web01 (14-02)',
    '2026-06-30 abc123de',
  ]);
});

test('truncate keeps head and tail with marker', () => {
  const out = truncate('x'.repeat(1000), 100);
  assert.ok(out.length < 200);
  assert.match(out, /truncated 900 chars/);
  assert.equal(truncate('short', 100), 'short');
});

test('stampFrontmatter adds then replaces keys', () => {
  const once = stampFrontmatter(CLAUDE, { summarizedAt: 'T1', summaryModel: 'm' });
  assert.match(once, /summarizedAt: T1/);
  assert.match(once, /summaryModel: m/);
  const twice = stampFrontmatter(once, { summarizedAt: 'T2' });
  assert.equal(twice.match(/summarizedAt:/g)?.length, 1);
  assert.match(twice, /summarizedAt: T2/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd obsidian-plugin/slimrdm-summarizer && npm test`
Expected: FAIL — cannot resolve `../src/notes.ts` (module does not exist yet).

- [ ] **Step 3: Implement `src/notes.ts`**

```ts
export type NoteType = 'claude' | 'ssh' | 'daily';

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

function splitFrontmatter(content: string): { raw: string; fm: string; body: string } {
  const m = content.match(FM_RE);
  if (!m) return { raw: '', fm: '', body: content };
  return { raw: m[0], fm: m[1], body: content.slice(m[0].length) };
}

function tagList(fm: Record<string, unknown> | undefined): string[] {
  if (!fm) return [];
  const t = fm.tags;
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === 'string') return t.split(',').map((s) => s.trim());
  return [];
}

/** Line range [start, end) of the `## <heading>` section (heading line included). */
function sectionRange(lines: string[], heading: string): [number, number] | null {
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end++;
  return [start, end];
}

function sectionBody(body: string, heading: string): string | null {
  const lines = body.split('\n');
  const range = sectionRange(lines, heading);
  if (!range) return null;
  return lines.slice(range[0] + 1, range[1]).join('\n').trim();
}

export function classify(fm: Record<string, unknown> | undefined): NoteType | null {
  if (!fm) return null;
  if (fm.type === 'claude') return 'claude';
  if (fm.type === 'ssh') return 'ssh';
  if (tagList(fm).includes('daily')) return 'daily';
  return null;
}

export function isSummarized(fm: Record<string, unknown> | undefined): boolean {
  return !!(fm && fm.summarizedAt);
}

export function extractSessionBody(content: string, type: NoteType): string {
  const { body } = splitFrontmatter(content);
  if (type === 'ssh') {
    const sec = sectionBody(body, 'Transcript') ?? '';
    const fence = sec.match(/```(?:text)?\n([\s\S]*?)```/);
    return (fence ? fence[1] : sec).trim();
  }
  return sectionBody(body, 'Conversation') ?? '';
}

export function extractSummarySection(content: string): string | null {
  const { body } = splitFrontmatter(content);
  return sectionBody(body, 'Summary');
}

export function dailyEmpty(content: string): boolean {
  const s = extractSummarySection(content);
  if (s === null) return true;
  return s.replace(/<!--[\s\S]*?-->/g, '').trim().length === 0;
}

export function collectDaySessionLinks(content: string): string[] {
  const { body } = splitFrontmatter(content);
  const out: string[] = [];
  for (const heading of ['Sessions', 'Claude Sessions']) {
    const sec = sectionBody(body, heading);
    if (!sec) continue;
    for (const m of sec.matchAll(/\[\[([^\]]+)\]\]/g)) out.push(m[1]);
  }
  return out;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head;
  const removed = text.length - maxChars;
  return (
    text.slice(0, head) +
    `\n\n…[truncated ${removed} chars]…\n\n` +
    text.slice(text.length - tail)
  );
}

export function upsertSummarySection(content: string, summary: string): string {
  const { raw, body } = splitFrontmatter(content);
  const lines = body.split('\n');
  const blockLines = ['## Summary', '', summary.trim(), ''];
  const range = sectionRange(lines, 'Summary');
  let out: string[];
  if (range) {
    out = [...lines.slice(0, range[0]), ...blockLines, ...lines.slice(range[1])];
  } else {
    const firstH = lines.findIndex((l) => l.startsWith('## '));
    const at = firstH === -1 ? lines.length : firstH;
    out = [...lines.slice(0, at), ...blockLines, ...lines.slice(at)];
  }
  let bodyOut = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  if (!bodyOut.endsWith('\n')) bodyOut += '\n';
  return raw ? `${raw}\n${bodyOut}` : bodyOut;
}

export function stampFrontmatter(content: string, stamps: Record<string, string>): string {
  const m = content.match(FM_RE);
  if (!m) return content;
  const lines = m[1].split('\n');
  for (const [k, v] of Object.entries(stamps)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (i !== -1) lines[i] = `${k}: ${v}`;
    else lines.push(`${k}: ${v}`);
  }
  return `---\n${lines.join('\n')}\n---\n` + content.slice(m[0].length);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd obsidian-plugin/slimrdm-summarizer && npm test`
Expected: PASS — all `notes.test.ts` tests green.

- [ ] **Step 5: Commit**

```bash
git add obsidian-plugin/slimrdm-summarizer/src/notes.ts obsidian-plugin/slimrdm-summarizer/test/notes.test.ts
git commit -m "feat(summarizer): pure note parsing + section-edit helpers"
```

---

### Task 3: Prompt templates (`prompts.ts`) — TDD

**Files:**
- Create: `obsidian-plugin/slimrdm-summarizer/src/prompts.ts`
- Test: `obsidian-plugin/slimrdm-summarizer/test/prompts.test.ts`

**Interfaces:**
- Consumes: `type NoteType` from `src/notes.ts` (type-only import).
- Produces:
  - `DEFAULT_SESSION_PROMPT: string` (contains `{{content}}`)
  - `DEFAULT_DAILY_PROMPT: string` (contains `{{summaries}}`)
  - `buildSessionPrompt(template: string, type: NoteType, content: string): string`
  - `buildDailyPrompt(template: string, summaries: string[]): string`

- [ ] **Step 1: Write the failing tests**

Create `test/prompts.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionPrompt, buildDailyPrompt, DEFAULT_SESSION_PROMPT, DEFAULT_DAILY_PROMPT,
} from '../src/prompts.ts';

test('buildSessionPrompt substitutes type and content', () => {
  const p = buildSessionPrompt('Type={{type}} Body={{content}}', 'claude', 'hello');
  assert.equal(p, 'Type=claude Body=hello');
});

test('default session prompt has content placeholder replaced', () => {
  const p = buildSessionPrompt(DEFAULT_SESSION_PROMPT, 'ssh', 'TRANSCRIPT_BODY');
  assert.match(p, /TRANSCRIPT_BODY/);
  assert.doesNotMatch(p, /\{\{content\}\}/);
});

test('buildDailyPrompt numbers summaries', () => {
  const p = buildDailyPrompt('S:{{summaries}}', ['one', 'two']);
  assert.match(p, /1\. one/);
  assert.match(p, /2\. two/);
});

test('default daily prompt replaces summaries placeholder', () => {
  const p = buildDailyPrompt(DEFAULT_DAILY_PROMPT, ['a']);
  assert.doesNotMatch(p, /\{\{summaries\}\}/);
  assert.match(p, /1\. a/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd obsidian-plugin/slimrdm-summarizer && npm test`
Expected: FAIL — cannot resolve `../src/prompts.ts`.

- [ ] **Step 3: Implement `src/prompts.ts`**

```ts
import type { NoteType } from './notes.ts';

export const DEFAULT_SESSION_PROMPT = `You are summarizing a developer work session. Write a concise summary: one short paragraph describing what was done, then 2–5 bullet points of the key actions, decisions, and outcomes. Be factual and specific. Do not add any preamble or sign-off.

Session content:
{{content}}`;

export const DEFAULT_DAILY_PROMPT = `You are writing a daily work-journal entry from several session summaries. Synthesize them into one short overview paragraph, then 3–6 bullets covering the day's key activities and outcomes across all sessions. Be concise and factual. Do not add any preamble or sign-off.

Session summaries:
{{summaries}}`;

export function buildSessionPrompt(template: string, type: NoteType, content: string): string {
  return template.split('{{type}}').join(type).split('{{content}}').join(content);
}

export function buildDailyPrompt(template: string, summaries: string[]): string {
  const joined = summaries.map((s, i) => `${i + 1}. ${s}`).join('\n\n');
  return template.split('{{summaries}}').join(joined);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd obsidian-plugin/slimrdm-summarizer && npm test`
Expected: PASS — both `notes.test.ts` and `prompts.test.ts` green.

- [ ] **Step 5: Commit**

```bash
git add obsidian-plugin/slimrdm-summarizer/src/prompts.ts obsidian-plugin/slimrdm-summarizer/test/prompts.test.ts
git commit -m "feat(summarizer): prompt templates + assembly"
```

---

### Task 4: Ollama HTTP client (`ollama.ts`)

**Files:**
- Create: `obsidian-plugin/slimrdm-summarizer/src/ollama.ts`

**Interfaces:**
- Consumes: `requestUrl` from `obsidian`.
- Produces:
  - `interface GenerateOptions { endpoint: string; model: string; prompt: string; temperature: number; timeoutMs: number }`
  - `generate(o: GenerateOptions): Promise<string>` — POSTs to `${endpoint}/api/generate` with `stream:false`; resolves to the trimmed `response`; rejects on timeout, non-200, or empty response.

> Not unit-tested: depends on Obsidian's `requestUrl`. Verified by the manual curl check below and end-to-end in Task 7.

- [ ] **Step 1: Implement `src/ollama.ts`**

```ts
import { requestUrl } from 'obsidian';

export interface GenerateOptions {
  endpoint: string;
  model: string;
  prompt: string;
  temperature: number;
  timeoutMs: number;
}

export async function generate(o: GenerateOptions): Promise<string> {
  const url = `${o.endpoint.replace(/\/$/, '')}/api/generate`;
  const body = JSON.stringify({
    model: o.model,
    prompt: o.prompt,
    stream: false,
    options: { temperature: o.temperature },
  });

  const req = requestUrl({
    url,
    method: 'POST',
    contentType: 'application/json',
    body,
    throw: false,
  });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Ollama request timed out after ${o.timeoutMs} ms`)),
      o.timeoutMs,
    ),
  );

  const res = await Promise.race([req, timeout]);
  if (res.status !== 200) {
    throw new Error(`Ollama returned HTTP ${res.status}`);
  }
  const text: string = (res.json?.response ?? '').trim();
  if (!text) {
    throw new Error('Ollama returned an empty response');
  }
  return text;
}
```

- [ ] **Step 2: Verify the build compiles the new module**

Run: `cd obsidian-plugin/slimrdm-summarizer && npm run build`
Expected: esbuild success (module type-checked at bundle time via TS; no runtime yet).

- [ ] **Step 3: Manually verify Ollama is reachable and the model responds**

Run: `curl -s http://localhost:11434/api/generate -d '{"model":"qwen2.5:14b","prompt":"Say hello in five words.","stream":false}'`
Expected: JSON with a non-empty `"response"` field. (Confirms the endpoint/model the client targets. If it 404s on the model, `ollama pull qwen2.5:14b` first.)

- [ ] **Step 4: Commit**

```bash
git add obsidian-plugin/slimrdm-summarizer/src/ollama.ts
git commit -m "feat(summarizer): Ollama generate() client with timeout"
```

---

### Task 5: Settings model + settings tab (`settings.ts`)

**Files:**
- Create: `obsidian-plugin/slimrdm-summarizer/src/settings.ts`

**Interfaces:**
- Consumes: `App`, `PluginSettingTab`, `Setting` from `obsidian`; `DEFAULT_SESSION_PROMPT`, `DEFAULT_DAILY_PROMPT` from `src/prompts.ts`; the plugin type (imported for the tab constructor) from `src/main.ts`.
- Produces:
  - `interface SlimrdmSummarizerSettings { endpoint; model; timeoutSec; temperature; runOnStartup; startupDelayMs; scanFolders: string[]; summarizeSsh: boolean; maxChars: number; sessionPrompt: string; dailyPrompt: string }`
  - `DEFAULT_SETTINGS: SlimrdmSummarizerSettings`
  - `class SlimrdmSummarizerSettingTab extends PluginSettingTab`

> The `import type SlimrdmSummarizerPlugin from './main.ts'` is type-only, so it does not create a runtime cycle.

- [ ] **Step 1: Implement `src/settings.ts`**

```ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import type SlimrdmSummarizerPlugin from './main.ts';
import { DEFAULT_SESSION_PROMPT, DEFAULT_DAILY_PROMPT } from './prompts.ts';

export interface SlimrdmSummarizerSettings {
  endpoint: string;
  model: string;
  timeoutSec: number;
  temperature: number;
  runOnStartup: boolean;
  startupDelayMs: number;
  scanFolders: string[];
  summarizeSsh: boolean;
  maxChars: number;
  sessionPrompt: string;
  dailyPrompt: string;
}

export const DEFAULT_SETTINGS: SlimrdmSummarizerSettings = {
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5:14b',
  timeoutSec: 300,
  temperature: 0.3,
  runOnStartup: true,
  startupDelayMs: 5000,
  scanFolders: ['Claude', 'SlimRDM', 'Daily'],
  summarizeSsh: true,
  maxChars: 12000,
  sessionPrompt: DEFAULT_SESSION_PROMPT,
  dailyPrompt: DEFAULT_DAILY_PROMPT,
};

export class SlimrdmSummarizerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SlimrdmSummarizerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName('Ollama endpoint')
      .setDesc('Base URL of your local Ollama server.')
      .addText((t) =>
        t.setValue(s.endpoint).onChange(async (v) => {
          s.endpoint = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Model tag')
      .setDesc('Ollama model used for summaries, e.g. qwen2.5:14b.')
      .addText((t) =>
        t.setValue(s.model).onChange(async (v) => {
          s.model = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Request timeout (seconds)')
      .addText((t) =>
        t.setValue(String(s.timeoutSec)).onChange(async (v) => {
          const n = Number(v);
          if (!Number.isNaN(n) && n > 0) {
            s.timeoutSec = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Temperature')
      .addText((t) =>
        t.setValue(String(s.temperature)).onChange(async (v) => {
          const n = Number(v);
          if (!Number.isNaN(n) && n >= 0) {
            s.temperature = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Run on startup')
      .setDesc('Summarize unsummarized notes shortly after Obsidian loads.')
      .addToggle((t) =>
        t.setValue(s.runOnStartup).onChange(async (v) => {
          s.runOnStartup = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Startup delay (ms)')
      .addText((t) =>
        t.setValue(String(s.startupDelayMs)).onChange(async (v) => {
          const n = Number(v);
          if (!Number.isNaN(n) && n >= 0) {
            s.startupDelayMs = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Scan folders')
      .setDesc('Comma-separated vault folders to scan. Classification is still by frontmatter.')
      .addText((t) =>
        t.setValue(s.scanFolders.join(', ')).onChange(async (v) => {
          s.scanFolders = v.split(',').map((x) => x.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Summarize SSH sessions')
      .setDesc('Claude sessions are always summarized; SSH sessions are optional.')
      .addToggle((t) =>
        t.setValue(s.summarizeSsh).onChange(async (v) => {
          s.summarizeSsh = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Max transcript characters')
      .setDesc('Transcripts longer than this are truncated (head + tail) before sending.')
      .addText((t) =>
        t.setValue(String(s.maxChars)).onChange(async (v) => {
          const n = Number(v);
          if (!Number.isNaN(n) && n > 0) {
            s.maxChars = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Session prompt template')
      .setDesc('Use {{content}} for the transcript and {{type}} for the note type.')
      .addTextArea((t) => {
        t.setValue(s.sessionPrompt).onChange(async (v) => {
          s.sessionPrompt = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 6;
        t.inputEl.style.width = '100%';
      });

    new Setting(containerEl)
      .setName('Daily prompt template')
      .setDesc('Use {{summaries}} for the numbered list of per-session summaries.')
      .addTextArea((t) => {
        t.setValue(s.dailyPrompt).onChange(async (v) => {
          s.dailyPrompt = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 6;
        t.inputEl.style.width = '100%';
      });
  }
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd obsidian-plugin/slimrdm-summarizer && npm run build`
Expected: esbuild success. (A `Cannot find module './main.ts'` here means Task 6 hasn't run yet — that's OK; esbuild resolves the type-only import as external. If the build fails on it, proceed to Task 6 then re-run.)

- [ ] **Step 3: Commit**

```bash
git add obsidian-plugin/slimrdm-summarizer/src/settings.ts
git commit -m "feat(summarizer): settings model + settings tab"
```

---

### Task 6: Orchestration (`summarizer.ts`)

**Files:**
- Create: `obsidian-plugin/slimrdm-summarizer/src/summarizer.ts`

**Interfaces:**
- Consumes: `App`, `Notice`, `TFile` from `obsidian`; all helpers from `src/notes.ts`; `buildSessionPrompt`, `buildDailyPrompt` from `src/prompts.ts`; `generate` from `src/ollama.ts`; `SlimrdmSummarizerSettings` from `src/settings.ts`.
- Produces:
  - `class Summarizer` with:
    - `constructor(app: App, getSettings: () => SlimrdmSummarizerSettings, setStatus: (t: string) => void)`
    - `cancel(): void`
    - `get isRunning(): boolean`
    - `summarizeSession(file: TFile, type: NoteType, force?: boolean): Promise<boolean>`
    - `summarizeDaily(file: TFile, force?: boolean): Promise<boolean>`
    - `runCatchUp(force?: boolean): Promise<void>`

> Not unit-tested (needs Obsidian `Vault`/`MetadataCache`); verified end-to-end in Task 7. The pure logic it composes is already covered by Tasks 2–3.

- [ ] **Step 1: Implement `src/summarizer.ts`**

```ts
import { App, Notice, TFile } from 'obsidian';
import type { SlimrdmSummarizerSettings } from './settings.ts';
import {
  classify, isSummarized, extractSessionBody, extractSummarySection,
  dailyEmpty, collectDaySessionLinks, truncate, upsertSummarySection, stampFrontmatter,
  type NoteType,
} from './notes.ts';
import { buildSessionPrompt, buildDailyPrompt } from './prompts.ts';
import { generate } from './ollama.ts';

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export class Summarizer {
  private cancelled = false;
  private running = false;

  constructor(
    private app: App,
    private getSettings: () => SlimrdmSummarizerSettings,
    private setStatus: (text: string) => void,
  ) {}

  cancel(): void {
    this.cancelled = true;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private frontmatter(file: TFile): Record<string, unknown> | undefined {
    return this.app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
  }

  private inScanFolder(file: TFile): boolean {
    const folders = this.getSettings().scanFolders;
    if (folders.length === 0) return true;
    return folders.some(
      (f) => file.path === f || file.path.startsWith(f.replace(/\/$/, '') + '/'),
    );
  }

  private candidates(): { file: TFile; type: NoteType }[] {
    const out: { file: TFile; type: NoteType }[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.inScanFolder(file)) continue;
      const type = classify(this.frontmatter(file));
      if (type) out.push({ file, type });
    }
    return out;
  }

  private async runGenerate(prompt: string): Promise<string> {
    const s = this.getSettings();
    return generate({
      endpoint: s.endpoint,
      model: s.model,
      prompt,
      temperature: s.temperature,
      timeoutMs: s.timeoutSec * 1000,
    });
  }

  async summarizeSession(file: TFile, type: NoteType, force = false): Promise<boolean> {
    if (!force && isSummarized(this.frontmatter(file))) return false;
    const content = await this.app.vault.read(file);
    const bodyText = extractSessionBody(content, type);
    if (!bodyText.trim()) return false;
    const s = this.getSettings();
    const prompt = buildSessionPrompt(s.sessionPrompt, type, truncate(bodyText, s.maxChars));
    const summary = await this.runGenerate(prompt);
    let out = upsertSummarySection(content, summary);
    out = stampFrontmatter(out, { summarizedAt: nowStamp(), summaryModel: s.model });
    await this.app.vault.modify(file, out);
    return true;
  }

  async summarizeDaily(file: TFile, force = false): Promise<boolean> {
    if (!force && isSummarized(this.frontmatter(file))) return false;
    const content = await this.app.vault.read(file);
    if (!force && !dailyEmpty(content)) return false;

    const summaries: string[] = [];
    for (const stem of collectDaySessionLinks(content)) {
      const target = this.app.metadataCache.getFirstLinkpathDest(stem, file.path);
      if (!target) continue;
      const s = extractSummarySection(await this.app.vault.read(target));
      if (s) summaries.push(s);
    }
    if (summaries.length === 0) return false;

    const settings = this.getSettings();
    const prompt = buildDailyPrompt(settings.dailyPrompt, summaries);
    const summary = await this.runGenerate(prompt);
    let out = upsertSummarySection(content, summary);
    out = stampFrontmatter(out, { summarizedAt: nowStamp(), summaryModel: settings.model });
    await this.app.vault.modify(file, out);
    return true;
  }

  async runCatchUp(force = false): Promise<void> {
    if (this.running) {
      new Notice('Summarization already running.');
      return;
    }
    this.running = true;
    this.cancelled = false;
    try {
      const s = this.getSettings();
      const cands = this.candidates();
      const claude = cands.filter((c) => c.type === 'claude');
      const ssh = s.summarizeSsh ? cands.filter((c) => c.type === 'ssh') : [];
      const daily = cands.filter((c) => c.type === 'daily');
      const sessions = [...claude, ...ssh];
      const total = sessions.length + daily.length;
      let done = 0;

      for (const { file, type } of sessions) {
        if (this.cancelled) break;
        this.setStatus(`Summarizing ${++done}/${total}: ${file.basename}`);
        try {
          await this.summarizeSession(file, type, force);
        } catch (e) {
          new Notice(`Summarize failed: ${file.basename} — ${(e as Error).message}`);
        }
      }
      for (const { file } of daily) {
        if (this.cancelled) break;
        this.setStatus(`Summarizing ${++done}/${total}: ${file.basename}`);
        try {
          await this.summarizeDaily(file, force);
        } catch (e) {
          new Notice(`Summarize failed: ${file.basename} — ${(e as Error).message}`);
        }
      }
      this.setStatus(this.cancelled ? 'Summarization cancelled.' : 'Summarization complete.');
      window.setTimeout(() => this.setStatus(''), 5000);
    } finally {
      this.running = false;
    }
  }
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd obsidian-plugin/slimrdm-summarizer && npm run build`
Expected: esbuild success.

- [ ] **Step 3: Commit**

```bash
git add obsidian-plugin/slimrdm-summarizer/src/summarizer.ts
git commit -m "feat(summarizer): orchestration (Claude-first passes, daily rollup, cancel)"
```

---

### Task 7: Plugin wiring (`main.ts`), deploy, and end-to-end verification

**Files:**
- Modify: `obsidian-plugin/slimrdm-summarizer/src/main.ts` (replace the placeholder)
- Create: `obsidian-plugin/slimrdm-summarizer/README.md`

**Interfaces:**
- Consumes: `Plugin`, `Notice`, `TFile` from `obsidian`; `SlimrdmSummarizerSettings`, `DEFAULT_SETTINGS`, `SlimrdmSummarizerSettingTab` from `src/settings.ts`; `Summarizer` from `src/summarizer.ts`; `classify` from `src/notes.ts`.
- Produces: default-exported `SlimrdmSummarizerPlugin` with a public `settings` field and `saveSettings()`, registered commands, a ribbon icon, a status-bar item, and startup catch-up.

- [ ] **Step 1: Replace `src/main.ts`**

```ts
import { Notice, Plugin, TFile } from 'obsidian';
import {
  SlimrdmSummarizerSettings,
  DEFAULT_SETTINGS,
  SlimrdmSummarizerSettingTab,
} from './settings.ts';
import { Summarizer } from './summarizer.ts';
import { classify } from './notes.ts';

function todayDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default class SlimrdmSummarizerPlugin extends Plugin {
  settings!: SlimrdmSummarizerSettings;
  private summarizer!: Summarizer;
  private statusBar!: HTMLElement;

  async onload() {
    await this.loadSettings();
    this.statusBar = this.addStatusBarItem();
    this.summarizer = new Summarizer(
      this.app,
      () => this.settings,
      (t) => this.statusBar.setText(t),
    );

    this.addCommand({
      id: 'summarize-all',
      name: 'Summarize all unsummarized SlimRDM notes',
      callback: () => this.summarizer.runCatchUp(false),
    });
    this.addCommand({
      id: 'summarize-current',
      name: 'Summarize current note',
      callback: () => this.summarizeActive(false),
    });
    this.addCommand({
      id: 're-summarize-current',
      name: 'Re-summarize current note (ignore stamp)',
      callback: () => this.summarizeActive(true),
    });
    this.addCommand({
      id: 'summarize-today',
      name: "Summarize today's daily note",
      callback: () => this.summarizeToday(),
    });
    this.addCommand({
      id: 'cancel-summarize',
      name: 'Cancel summarization',
      callback: () => this.summarizer.cancel(),
    });

    this.addRibbonIcon('sparkles', 'Summarize SlimRDM notes', () =>
      this.summarizer.runCatchUp(false),
    );
    this.addSettingTab(new SlimrdmSummarizerSettingTab(this.app, this));

    if (this.settings.runOnStartup) {
      window.setTimeout(
        () => this.summarizer.runCatchUp(false),
        this.settings.startupDelayMs,
      );
    }
  }

  private async summarizeActive(force: boolean) {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice('No active note.');
      return;
    }
    const type = classify(
      this.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined,
    );
    if (!type) {
      new Notice('Not a SlimRDM note.');
      return;
    }
    try {
      const changed =
        type === 'daily'
          ? await this.summarizer.summarizeDaily(file, force)
          : await this.summarizer.summarizeSession(file, type, force);
      new Notice(changed ? 'Summarized.' : 'Skipped (already summarized or empty).');
    } catch (e) {
      new Notice(`Summarize failed: ${(e as Error).message}`);
    }
  }

  private async summarizeToday() {
    const path = `Daily/${todayDate()}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`No daily note at ${path}.`);
      return;
    }
    try {
      const changed = await this.summarizer.summarizeDaily(file, true);
      new Notice(changed ? "Summarized today's note." : 'Nothing to summarize.');
    } catch (e) {
      new Notice(`Summarize failed: ${(e as Error).message}`);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Step 2: Create `README.md`**

````markdown
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
````

- [ ] **Step 3: Build and run unit tests together**

Run: `cd obsidian-plugin/slimrdm-summarizer && npm test && npm run build`
Expected: all unit tests PASS and esbuild produces `main.js`.

- [ ] **Step 4: Deploy into the vault**

Run (PowerShell): `cd obsidian-plugin/slimrdm-summarizer; $env:SLIMRDM_VAULT="<your vault path>"; npm run deploy`
Expected: "Deployed slimrdm-summarizer to …\.obsidian\plugins\slimrdm-summarizer".

- [ ] **Step 5: End-to-end manual verification in Obsidian**

With Ollama running and at least one Claude session note + one SSH session note + today's daily note present in the vault:
1. Enable the plugin (Settings → Community plugins). Confirm the settings tab shows defaults (model `qwen2.5:14b`).
2. Run **Summarize all unsummarized SlimRDM notes**; watch the status bar count up.
3. Confirm a **Claude** note gains a `## Summary` **above** `## Conversation`, an **SSH** note gains one **above** `## Transcript`, and both get `summarizedAt` + `summaryModel` frontmatter.
4. Confirm today's **daily** note's `## Summary` is filled (placeholder gone) and the `## Sessions` / `## Claude Sessions` link lists are intact.
5. Run **Summarize all** again → everything is skipped (fast), proving idempotency.
6. Run **Re-summarize current note** on a session note → its `## Summary` is replaced (not duplicated).
7. Stop Ollama and run **Summarize current note** on an unstamped note → a Notice reports the failure and the note stays unstamped (no corruption).

- [ ] **Step 6: Commit**

```bash
git add obsidian-plugin/slimrdm-summarizer/src/main.ts obsidian-plugin/slimrdm-summarizer/README.md
git commit -m "feat(summarizer): plugin wiring, commands, startup catch-up, docs"
```

---

## Self-Review

**Spec coverage:**
- Obsidian plugin, source-in-repo → build-into-vault → Task 1 (scaffold + `deploy.mjs`).
- Note identification by frontmatter → `classify` (Task 2), used by `summarizer.candidates()` (Task 6).
- Per-session summaries, Claude-first + optional SSH → `summarizeSession` + ordering in `runCatchUp` (Task 6); `summarizeSsh` setting (Task 5).
- Daily rollup from per-session summaries → `summarizeDaily` + `collectDaySessionLinks`/`extractSummarySection` (Tasks 2, 6).
- `## Summary` placement above first heading / replace-in-place; frontmatter stamps → `upsertSummarySection` + `stampFrontmatter` (Task 2).
- Idempotency via `summarizedAt` → `isSummarized` (Task 2), honored in Task 6, overridable by force (Tasks 6–7).
- Startup catch-up + delay → Task 7; manual commands + ribbon + cancel → Task 7 / `cancel()` Task 6.
- Sequential, progress, cancel → `runCatchUp` loop + status bar (Tasks 6–7).
- Ollama client, `stream:false`, timeout, empty→error → Task 4.
- Error handling via Notice, leave unstamped → Tasks 6–7; verified in Task 7 Step 5.7.
- Settings (all rows from the spec table) → Task 5.
- Truncation → `truncate` (Task 2), applied in `summarizeSession` (Task 6).
- Testing: pure unit tests (Tasks 2–3), manual E2E (Tasks 4, 7).

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — all code shown in full.

**Type consistency:** `NoteType`, `SlimrdmSummarizerSettings`, `GenerateOptions`, `Summarizer` method signatures, and `classify`/`isSummarized`/`upsertSummarySection`/`stampFrontmatter`/`extractSessionBody`/`extractSummarySection`/`dailyEmpty`/`collectDaySessionLinks`/`truncate`/`buildSessionPrompt`/`buildDailyPrompt`/`generate` names match across the tasks that define and consume them. `getSettings: () => SlimrdmSummarizerSettings` getter avoids stale-settings bugs after `saveSettings`.
