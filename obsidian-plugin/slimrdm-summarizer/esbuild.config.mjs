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
