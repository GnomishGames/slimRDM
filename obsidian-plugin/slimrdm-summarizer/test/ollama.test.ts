import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerateBody } from '../src/ollama-body.ts';

const base = {
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5-coder:14b',
  prompt: 'summarize this',
  temperature: 0.3,
  numCtx: 16384,
  timeoutMs: 300000,
};

test('buildGenerateBody sends num_ctx and temperature in options', () => {
  const body = buildGenerateBody(base);
  assert.equal(body.options.num_ctx, 16384);
  assert.equal(body.options.temperature, 0.3);
});

test('buildGenerateBody carries model/prompt and disables streaming', () => {
  const body = buildGenerateBody({ ...base, numCtx: 8192 });
  assert.equal(body.model, 'qwen2.5-coder:14b');
  assert.equal(body.prompt, 'summarize this');
  assert.equal(body.stream, false);
  assert.equal(body.options.num_ctx, 8192);
});
