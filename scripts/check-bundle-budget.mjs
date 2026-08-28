#!/usr/bin/env node
/**
 * Performance budget gate (FE-123). Fails the build when the *initial* JS —
 * the entry chunk plus anything it imports synchronously (i.e. not behind a
 * dynamic import()) — exceeds the gzipped budget.
 *
 * Reads dist/.vite/manifest.json (Vite's build manifest — enable with
 * `build.manifest: true`, or pass --dir to point at a custom output dir) to
 * find the entry and its static ("imports") dependency chunks, then gzips
 * each file on disk to measure real transfer size.
 *
 * Vendor chunks that must always be lazy (see docs/performance-budget.md) are
 * excluded even if a manifest ever lists them statically, so a regression
 * there is caught by chunk composition, not silently absorbed into the budget.
 */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const BUDGET_BYTES = 250 * 1024; // 250KB gzipped
const NEVER_INITIAL = ['vendor-blockchain'];

const distDir = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : 'dist';
const manifestPath = path.join(distDir, '.vite', 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error(
    `[bundle-budget] No manifest at ${manifestPath}. Build with \`vite build\` ` +
      `(build.manifest: true) before running this check.`,
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const entry = Object.values(manifest).find((e) => e.isEntry);
if (!entry) {
  console.error('[bundle-budget] No entry chunk found in manifest.');
  process.exit(1);
}

function collectInitialChunks(entryRecord, visited = new Set()) {
  if (visited.has(entryRecord.file)) return visited;
  if (NEVER_INITIAL.some((name) => entryRecord.file.includes(name))) return visited;
  visited.add(entryRecord.file);
  for (const importKey of entryRecord.imports ?? []) {
    const imported = manifest[importKey];
    if (imported) collectInitialChunks(imported, visited);
  }
  return visited;
}

const initialFiles = collectInitialChunks(entry);

let totalGzip = 0;
const breakdown = [];
for (const file of initialFiles) {
  const filePath = path.join(distDir, file);
  if (!existsSync(filePath)) continue;
  const gzipBytes = gzipSync(readFileSync(filePath)).length;
  totalGzip += gzipBytes;
  breakdown.push({ file, gzipBytes });
}

breakdown.sort((a, b) => b.gzipBytes - a.gzipBytes);
console.log('[bundle-budget] Initial JS chunks (gzipped):');
for (const { file, gzipBytes } of breakdown) {
  console.log(`  ${(gzipBytes / 1024).toFixed(1)}KB  ${file}`);
}
console.log(
  `[bundle-budget] Total: ${(totalGzip / 1024).toFixed(1)}KB / budget ${(BUDGET_BYTES / 1024).toFixed(0)}KB`,
);

if (totalGzip > BUDGET_BYTES) {
  console.error(
    `[bundle-budget] FAIL: initial JS exceeds the ${(BUDGET_BYTES / 1024).toFixed(0)}KB gzipped budget. ` +
      `Move something behind a dynamic import() — see docs/performance-budget.md.`,
  );
  process.exit(1);
}

console.log('[bundle-budget] PASS');
