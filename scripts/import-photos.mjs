#!/usr/bin/env node
/**
 * Import photos of book pages (phone camera, scanner app) as OCR-ready pages.
 *
 * The Kindle and PDF paths produce `page_NNN` images in reading order for free.
 * A folder of camera photos does not: the names are whatever the phone chose,
 * and OCR downstream depends on the order being the reading order. So this
 * script decides the order, then renames into the same `page_NNN.webp` shape
 * the rest of the pipeline already understands — after which /ocr and /generate
 * work on photographed books exactly as they do on captured ones.
 *
 * Order is the photo's capture time (Spotlight's kMDItemContentCreationDate,
 * which is the EXIF timestamp for camera files), falling back to a natural
 * filename sort so IMG_9 precedes IMG_10. Pass --order filename to force the
 * latter when the timestamps are wrong — a re-shot page keeps its slot in the
 * filename sequence but jumps to the end in time order.
 *
 * HEIC is read directly; no conversion step first. Originals are never touched.
 *
 *   node import-photos.mjs <photo-dir> --output-dir <dir> [--order time|filename] [--dry-run]
 */

import { readdir, mkdir, stat } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { writePageImage, pageImageName } from './book-capture-utils.mjs';

const execFileAsync = promisify(execFile);

const PHOTO_RE = /\.(heic|heif|jpe?g|png|tiff?|webp)$/i;

/** Spotlight knows a camera file's EXIF capture time; null for anything it cannot date. */
async function captureTime(file) {
  try {
    const { stdout } = await execFileAsync('mdls', ['-raw', '-name', 'kMDItemContentCreationDate', file]);
    const value = stdout.trim();
    if (!value || value === '(null)') return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

/** IMG_9 before IMG_10, which a plain string sort gets backwards. */
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const outputDirArg = flagValue('--output-dir');
const order = flagValue('--order') || 'time';

const flagValues = new Set([outputDirArg, order].filter(Boolean));
const positional = argv.filter((a) => !a.startsWith('--') && !flagValues.has(a));

if (positional.length !== 1 || !outputDirArg) {
  console.error('usage: import-photos.mjs <photo-dir> --output-dir <dir> [--order time|filename] [--dry-run]');
  process.exit(1);
}
if (!['time', 'filename'].includes(order)) {
  console.error(`--order must be "time" or "filename", got "${order}"`);
  process.exit(1);
}

const srcDir = path.resolve(positional[0]);
const outputDir = path.resolve(outputDirArg);

const names = (await readdir(srcDir)).filter((f) => PHOTO_RE.test(f));
if (names.length === 0) {
  console.error(`No photos found in ${srcDir}`);
  process.exit(1);
}

let ordered;
if (order === 'filename') {
  ordered = names.sort(naturalCompare);
} else {
  const dated = await Promise.all(
    names.map(async (name) => ({ name, at: await captureTime(path.join(srcDir, name)) })),
  );
  const undatable = dated.filter((d) => d.at === null).length;
  if (undatable === dated.length) {
    console.log('No capture times available — falling back to filename order.');
    ordered = names.sort(naturalCompare);
  } else {
    if (undatable > 0) {
      // Undated files sort last under a plain comparator, which would silently
      // move them to the back of the book. Say so rather than reorder quietly.
      console.log(`Warning: ${undatable} photo(s) have no capture time; they keep filename order among themselves and sort last.`);
    }
    ordered = dated
      .sort((a, b) => {
        if (a.at !== null && b.at !== null) return a.at - b.at || naturalCompare(a.name, b.name);
        if (a.at === null && b.at === null) return naturalCompare(a.name, b.name);
        return a.at === null ? 1 : -1;
      })
      .map((d) => d.name);
  }
}

console.log(`${ordered.length} photos, ordered by ${order}`);
console.log(`  first: ${ordered[0]}`);
console.log(`  last:  ${ordered[ordered.length - 1]}`);
if (dryRun) {
  ordered.forEach((name, i) => console.log(`  [dry-run] ${name} -> ${pageImageName(i + 1)}`));
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });

let before = 0, after = 0;
for (const [i, name] of ordered.entries()) {
  const src = path.join(srcDir, name);
  const dest = path.join(outputDir, pageImageName(i + 1));
  before += (await stat(src)).size;
  after += await writePageImage(src, dest);
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${ordered.length} pages...`);
}

const mb = (b) => (b / 1024 / 1024).toFixed(0);
console.log(`\nDone! ${ordered.length} pages -> ${outputDir}`);
console.log(`${mb(before)}MB -> ${mb(after)}MB (${(after * 100 / before).toFixed(0)}%)`);
console.log('Originals untouched. Run /ocr on the output directory next.');
