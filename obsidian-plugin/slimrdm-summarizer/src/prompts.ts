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
