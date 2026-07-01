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
