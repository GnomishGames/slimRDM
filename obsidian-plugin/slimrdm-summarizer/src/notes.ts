export type NoteType = 'claude' | 'ssh' | 'daily';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

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

/** Text from the `## <heading>` line to end of body (the section runs to EOF). */
function sectionToEnd(body: string, heading: string): string | null {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  return lines.slice(start + 1).join('\n').trim();
}

export function extractSessionBody(content: string, type: NoteType): string {
  const { body } = splitFrontmatter(content);
  if (type === 'ssh') {
    const sec = sectionToEnd(body, 'Transcript') ?? '';
    const fence = sec.match(/```(?:text)?\n([\s\S]*?)```/);
    return (fence ? fence[1] : sec).trim();
  }
  return sectionToEnd(body, 'Conversation') ?? '';
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
  const firstH = lines.findIndex((l) => l.startsWith('## '));
  let out: string[];
  if (firstH !== -1 && lines[firstH].trim() === '## Summary') {
    let end = firstH + 1;
    while (end < lines.length && !lines[end].startsWith('## ')) end++;
    out = [...lines.slice(0, firstH), ...blockLines, ...lines.slice(end)];
  } else {
    const at = firstH === -1 ? lines.length : firstH;
    out = [...lines.slice(0, at), ...blockLines, ...lines.slice(at)];
  }
  let bodyOut = out.join('\n').replace(/^\n+/, '');
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
