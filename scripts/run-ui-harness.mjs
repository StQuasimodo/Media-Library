#!/usr/bin/env node
/**
 * Bundles the headless UI harness (which imports the app's real service layer)
 * with esbuild and runs it. Kept separate from the harness itself so the harness
 * can use ordinary extensionless TypeScript imports.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = join(root, '.harness');
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, 'ui-harness.mjs');

await build({
  entryPoints: [join(root, 'scripts', 'ui-harness.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['better-sqlite3'],
  logLevel: 'warning',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});

await import(pathToFileURL(outfile).href);
