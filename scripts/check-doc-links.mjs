#!/usr/bin/env node
/**
 * Markdown internal-link check for the docs.
 *
 * Walks every `.md` file under `docs/` (optionally plus a list of extra files)
 * and verifies:
 *   - every relative and repo-rooted markdown link (`…\.md`) resolves to a real file;
 *   - every `#anchor` fragment on a link that points to a file with a matching
 *     ATX-style heading.
 *
 * Fails (exit 1) with a report of any broken links, so it can gate CI.
 *
 * Usage:
 *   node scripts/check-doc-links.mjs
 *   node scripts/check-doc-links.mjs --extra src/README.md
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, 'docs');

const extraArgs = process.argv.indexOf('--extra');
const extraFiles =
  extraArgs !== -1
    ? process.argv.slice(extraArgs + 1).filter((a) => !a.startsWith('--'))
    : [];

/** Recursively collect `*.md` files under a directory. */
function collectMd(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectMd(full, out);
    } else if (entry.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

const files = extraFiles.map((f) => path.join(ROOT, f));

if (existsSync(DOCS_DIR)) {
  files.push(...collectMd(DOCS_DIR));
}

// ATX headings (## …) for a file, used to validate `#anchor` fragments.
function headingsOf(absPath) {
  const headings = new Set();
  if (!existsSync(absPath)) return headings;
  const body = readFileSync(absPath, 'utf8');
  for (const line of body.split('\n')) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (!m) continue;
    const slug =
      m[1]
        .trim()
        .toLowerCase()
        .replace(/[`*]/g, '') // strip inline code/emphasis markers
        .replace(/[^\w\s-]/g, '') // drop punctuation
        .replace(/\s+/g, '-'); // spaces -> dashes
    headings.add(slug);
  }
  return headings;
}

const urlRe = /\[[^\]]*\]\(([^)]+)\)/g;
let failed = false;

function checkFile(absFile) {
  const body = readFileSync(absFile, 'utf8');
  const sourceRel = path.relative(ROOT, absFile);
  let match;
  while ((match = urlRe.exec(body)) !== null) {
    let target = match[1].split(' ')[0].trim(); // drop optional title
    if (!target || target.startsWith('http:') || target.startsWith('https:') || target.startsWith('#')) {
      continue; // external links and same-file anchors are out of scope
    }
    if (target.startsWith('mailto:') || target.startsWith('tel:')) continue;

    const [filePart, anchor] = target.split('#');
    let absTarget;
    if (target.startsWith('/')) {
      absTarget = path.join(ROOT, filePart);
    } else {
      absTarget = path.resolve(path.dirname(absFile), filePart);
    }

    const rel = `${sourceRel} -> ${target}`;
    if (filePart && !existsSync(absTarget)) {
      console.error(`  BROKEN FILE: ${rel}`);
      failed = true;
      continue;
    }
    if (anchor) {
      const headings = headingsOf(absTarget);
      if (!headings.has(anchor.toLowerCase().replace(/_/g, '-'))) {
        console.error(`  BROKEN ANCHOR: ${rel}`);
        failed = true;
      }
    }
  }
}

console.log(`[doc-links] Checking ${files.length} markdown file(s)…`);
for (const f of files) checkFile(f);

if (failed) {
  console.error('[doc-links] FAIL: broken internal links found in docs.');
  process.exit(1);
}
console.log('[doc-links] PASS');