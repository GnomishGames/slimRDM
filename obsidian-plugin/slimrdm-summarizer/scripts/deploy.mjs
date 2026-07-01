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
