/**
 * OCR Text Extraction — Vision Only
 *
 * Extracts text from page screenshots using macOS Vision framework.
 * For low-confidence or vertical Japanese text pages, marks them for
 * later processing by Claude Code agents.
 *
 * Usage: node extract-text.mjs <captures_dir> [--concurrency 5] [--claude-threshold 0.6]
 *
 * Output: <captures_dir>/raw_text.json
 *
 * Supports resume: if raw_text.json already exists, only processes missing pages.
 * Pages with confidence below threshold are included but flagged (method: 'vision-low').
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  ensureVisionOCR,
  runVisionOCR,
  parseArgs,
  progress,
  PAGE_IMAGE_RE,
} from './book-capture-utils.mjs';

// ─── Page Processing ─────────────────────────────────────────────────────

async function processPage(imagePath, pageNum, claudeThreshold) {
  try {
    const result = await runVisionOCR(imagePath);

    const method = (result.confidence >= claudeThreshold && result.text.trim().length > 0)
      ? 'vision'
      : 'vision-low';

    if (method === 'vision-low') {
      console.log(`\n  Page ${pageNum}: confidence ${result.confidence.toFixed(2)} < ${claudeThreshold} (flagged for agent review)`);
    }

    return {
      page: pageNum,
      text: result.text,
      confidence: result.confidence,
      method,
    };
  } catch (err) {
    console.log(`\n  Page ${pageNum}: Vision OCR failed (${err.message})`);
    return {
      page: pageNum,
      text: '',
      confidence: 0,
      method: 'failed',
    };
  }
}

// ─── Concurrency Control ─────────────────────────────────────────────────

async function processWithConcurrency(items, concurrency, handler) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await handler(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const { positional, flags } = parseArgs();
  const capturesDir = positional[0];

  if (!capturesDir) {
    console.error('Usage: node extract-text.mjs <captures_dir> [--concurrency 5] [--claude-threshold 0.6]');
    process.exit(1);
  }

  const resolvedDir = path.resolve(capturesDir);
  const outputPath = path.join(resolvedDir, 'raw_text.json');

  console.log(`\u{1F50D} OCR Text Extraction (Vision-only)`);
  console.log(`\u{1F4C1} Directory: ${resolvedDir}`);
  console.log(`\u{2699}\uFE0F  Concurrency: ${flags.concurrency}`);
  console.log(`\u{1F4CA} Low-confidence threshold: ${flags.claudeThreshold}\n`);

  // Ensure Vision OCR binary is compiled
  await ensureVisionOCR();

  // Find all page images (WebP now; PNG/JPG for books captured before the switch)
  const files = (await readdir(resolvedDir))
    .filter(f => PAGE_IMAGE_RE.test(f))
    .sort();

  if (files.length === 0) {
    console.error('No page_* image files found in the directory.');
    process.exit(1);
  }

  console.log(`Found ${files.length} page images.\n`);

  // Load existing results for resume support
  let existing = { pages: [] };
  try {
    const raw = await readFile(outputPath, 'utf-8');
    existing = JSON.parse(raw);
    console.log(`Resuming: ${existing.pages.length} pages already processed.`);
  } catch {
    // No existing file, start fresh
  }

  const processedPages = new Set(existing.pages.map(p => p.page));

  // Filter to unprocessed pages
  const toProcess = files
    .map((f) => {
      const pageNum = parseInt(f.match(/page_(\d+)/)[1], 10);
      return { file: f, pageNum, path: path.join(resolvedDir, f) };
    })
    .filter(p => !processedPages.has(p.pageNum));

  if (toProcess.length === 0) {
    console.log('All pages already processed!');
    printStats(existing);
    return;
  }

  console.log(`Processing ${toProcess.length} pages...\n`);

  const startTime = Date.now();
  let completed = 0;

  const results = await processWithConcurrency(
    toProcess,
    flags.concurrency,
    async (item) => {
      const result = await processPage(item.path, item.pageNum, flags.claudeThreshold);
      completed++;
      progress(completed, toProcess.length, `page ${item.pageNum} [${result.method}]`);
      return result;
    },
  );

  // Merge with existing results
  const allPages = [...existing.pages, ...results]
    .sort((a, b) => a.page - b.page);

  // Compute stats
  const stats = {
    total: allPages.length,
    vision: allPages.filter(p => p.method === 'vision').length,
    visionLow: allPages.filter(p => p.method === 'vision-low').length,
    failed: allPages.filter(p => p.method === 'failed').length,
    avgConfidence: 0,
  };

  const confidentPages = allPages.filter(p => p.confidence !== null && p.confidence > 0);
  if (confidentPages.length > 0) {
    stats.avgConfidence = parseFloat(
      (confidentPages.reduce((sum, p) => sum + p.confidence, 0) / confidentPages.length).toFixed(3)
    );
  }

  const output = { pages: allPages, stats };

  // Save results
  await writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  console.log(`\n\n\u2705 Extraction complete in ${elapsed}s`);
  printStats(output);
  console.log(`\u{1F4C4} Output: ${outputPath}\n`);

  if (stats.visionLow > 0 || stats.failed > 0) {
    console.log(`\u26A0\uFE0F  ${stats.visionLow + stats.failed} pages need agent review.`);
    console.log(`   Use /book-capture to dispatch Claude Code agents for these pages.\n`);
  }
}

function printStats(data) {
  const stats = data.stats || { total: data.pages?.length || 0, vision: 0, visionLow: 0, failed: 0, avgConfidence: 0 };
  console.log(`\u{1F4CA} Stats:`);
  console.log(`   Total pages:    ${stats.total}`);
  console.log(`   Vision (good):  ${stats.vision}`);
  console.log(`   Vision (low):   ${stats.visionLow || 0}`);
  if (stats.failed > 0) console.log(`   Failed:         ${stats.failed}`);
  console.log(`   Avg confidence: ${stats.avgConfidence}`);
}

main().catch(err => {
  console.error('\u274C', err.message);
  process.exit(1);
});
