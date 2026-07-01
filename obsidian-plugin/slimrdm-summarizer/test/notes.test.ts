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

test('upsertSummarySection preserves blank lines in untouched sections', () => {
  const note = `---
type: ssh
---

## Transcript

\`\`\`text
line1



line2
\`\`\`
`;
  const out = upsertSummarySection(note, 'S.');
  assert.ok(out.includes('line1\n\n\n\nline2'), out);
});

test('upsertSummarySection does not treat a ## line in body as the Summary', () => {
  const note = `---
type: claude
---

## Conversation

### 🧑 User

## Not a real section

done
`;
  const out = upsertSummarySection(note, 'Real summary.');
  assert.equal(out.match(/## Summary/g)?.length, 1);
  const sIdx = out.indexOf('## Summary');
  const cIdx = out.indexOf('## Conversation');
  assert.ok(sIdx < cIdx, out);
  assert.match(out, /## Not a real section/);
});

test('extractSessionBody keeps ## lines inside the conversation body', () => {
  const note = `---
type: claude
---

## Conversation

### 🧑 User

see below

## Heading in chat

more
`;
  const b = extractSessionBody(note, 'claude');
  assert.match(b, /## Heading in chat/);
  assert.match(b, /more/);
});

test('upsertSummarySection demotes markdown headings inside the summary', () => {
  const note = `---
type: claude
---

## Conversation

x
`;
  const out = upsertSummarySection(note, 'Overview\n\n## Details\n\nmore');
  const summarySec = extractSummarySection(out) ?? '';
  // The inner heading must be demoted so it can't break the section boundary…
  assert.doesNotMatch(summarySec, /## Details/);
  assert.match(summarySec, /Details/);
  // …and nothing after it is lost when read back (the daily-rollup path).
  assert.match(summarySec, /more/);
});

test('stampFrontmatter writes stamp on CRLF frontmatter', () => {
  const crlf = '---\r\ntype: claude\r\n---\r\n\r\n## Conversation\r\n\r\nhi\r\n';
  const out = stampFrontmatter(crlf, { summarizedAt: 'T1' });
  assert.match(out, /summarizedAt: T1/);
});
