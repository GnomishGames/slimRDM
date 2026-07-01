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
      numCtx: s.numCtx,
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
    } catch (e) {
      new Notice(`Summarization error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
