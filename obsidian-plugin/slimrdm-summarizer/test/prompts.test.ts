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
