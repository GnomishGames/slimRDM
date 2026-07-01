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
  numCtx: number;
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
  maxChars: 40000,
  numCtx: 16384,
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
      .setName('Context window (num_ctx)')
      .setDesc(
        'Tokens Ollama keeps in context. Larger fits bigger sessions but uses more VRAM and runs slower. ' +
          '16384 suits a 14B model on ~16GB VRAM.',
      )
      .addText((t) =>
        t.setValue(String(s.numCtx)).onChange(async (v) => {
          const n = Number(v);
          if (!Number.isNaN(n) && n > 0) {
            s.numCtx = n;
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
