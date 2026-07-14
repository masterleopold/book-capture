#!/usr/bin/env node
/**
 * Sweep a captures tree and re-encode every non-WebP page image to WebP.
 *
 * The capture scripts write WebP directly, so this is a safety net, not the
 * main path: it catches books captured before the switch and photos copied in
 * by hand. Idempotent — a page that already has its WebP is skipped, so it is
 * safe to re-run after an interrupted pass.
 *
 * POINT THIS AT A CAPTURES TREE, NOT AT A NOTES FOLDER. It rewrites images to a
 * new extension while keeping the basename, so an attachment that some note
 * embeds as `![[diagram.png]]` would still be there under a name nothing links
 * to. Capture trees are safe precisely because no markdown references them.
 *
 * Originals are MOVED to --stage (default: alongside the captures dir), never
 * deleted. Compression is lossy and irreversible; the caller decides when to
 * discard the archive.
 *
 *   node compress-captures.mjs <captures-root> [--stage <dir>] [--dry-run]
 */

import { readdir, mkdir, rename, stat } from 'fs/promises';
import path from 'path';
import { writePageImage, PAGE_IMAGE_EXT } from './book-capture-utils.mjs';

// Anything a camera or a capture script might leave behind. HEIC is what an
// iPhone writes by default, so a folder of photographed pages is usually HEIC.
const SOURCE_RE = /\.(heic|heif|png|jpe?g|tiff?)$/i;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && SOURCE_RE.test(entry.name)) yield full;
  }
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

// The shared parseArgs has a fixed flag set for the capture scripts and drops
// anything it does not know, so this script reads its own arguments.
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const stageIdx = argv.indexOf('--stage');
const stageValueIdx = stageIdx >= 0 ? stageIdx + 1 : -1;
const positional = argv.filter((a, i) =>
  !a.startsWith('--') && i !== stageValueIdx);

if (positional.length !== 1) {
  console.error('usage: compress-captures.mjs <captures-root> [--stage <dir>] [--dry-run]');
  process.exit(1);
}
const root = path.resolve(positional[0]);
const stage = path.resolve(stageIdx >= 0 ? argv[stageIdx + 1] : `${root}-original`);

let converted = 0, skipped = 0, before = 0, after = 0;

for await (const src of walk(root)) {
  const dest = src.replace(SOURCE_RE, `.${PAGE_IMAGE_EXT}`);
  if (await exists(dest)) { skipped++; continue; }

  const srcBytes = (await stat(src)).size;
  if (dryRun) {
    console.log(`  [dry-run] ${path.relative(root, src)}`);
    converted++; before += srcBytes;
    continue;
  }

  const destBytes = await writePageImage(src, dest);
  const staged = path.join(stage, path.relative(root, src));
  await mkdir(path.dirname(staged), { recursive: true });
  await rename(src, staged);

  converted++; before += srcBytes; after += destBytes;
  if (converted % 200 === 0) console.log(`  ${converted} pages...`);
}

const mb = (b) => (b / 1024 / 1024).toFixed(0);
console.log(`\nconverted ${converted}, skipped ${skipped} (already WebP)`);
if (!dryRun && converted) {
  console.log(`${mb(before)}MB -> ${mb(after)}MB (${(after * 100 / before).toFixed(0)}%)`);
  console.log(`originals moved to: ${stage}`);
}
