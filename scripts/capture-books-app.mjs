/**
 * Apple Books App Screenshot Capture
 *
 * Captures all pages of a book from Apple Books as screenshots.
 * Uses AppleScript for app control and screencapture for window capture.
 *
 * Usage: node capture-books-app.mjs <BookTitle> [--horizontal] [--max-pages 500]
 *
 * Prerequisites:
 *   - macOS Accessibility permission for Terminal
 *   - Apple Books app with the book already open
 *
 * Note: BookTitle is used as the folder name (sanitized).
 */

import { unlink } from 'fs/promises';
import path from 'path';
import {
  activateApp,
  captureWindowImage,
  ensureCapturesDir,
  getWindowIdByOwner,
  imagesMatch,
  pageImageName,
  parseArgs,
  sanitizeFilename,
  sendKeystroke,
  sleep,
} from './book-capture-utils.mjs';

const APP_NAME = 'Books';
const PAGE_RENDER_WAIT = 2000;
const DUPLICATE_THRESHOLD = 3;

async function main() {
  const { positional, flags } = parseArgs();
  const bookTitle = positional[0];

  if (!bookTitle) {
    console.error('Usage: node capture-books-app.mjs <BookTitle> [--horizontal] [--max-pages 500] [--output-dir <path>]');
    process.exit(1);
  }

  const folderId = sanitizeFilename(bookTitle);
  const direction = flags.horizontal ? 'horizontal (LTR)' : 'vertical (RTL)';
  // Apple Books navigation: direction depends on book layout
  // RTL (縦書き): left arrow = next page
  // LTR (horizontal): right arrow = next page
  // --page-down overrides both
  const nextKey = flags.pageDown ? 'page down' : (flags.horizontal ? 'right arrow' : 'left arrow');

  console.log(`\u{1F4D6} Apple Books Capture \u2014 "${bookTitle}"`);
  console.log(`\u{1F4D0} Direction: ${direction}`);
  console.log(`\u{1F4C4} Max pages: ${flags.maxPages}\n`);

  // Activate Books app
  console.log('Activating Apple Books...');
  await activateApp(APP_NAME);
  await sleep(1000);

  // Get window ID (exact match — "Books" not "iBooks")
  let windowId;
  try {
    windowId = await getWindowIdByOwner('Books', true);
    console.log(`Window ID: ${windowId}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Setup output directory (--output-dir overrides default)
  const outputDir = flags.outputDir
    ? await (async () => { const { mkdir } = await import('fs/promises'); const d = path.resolve(flags.outputDir); await mkdir(d, { recursive: true }); return d; })()
    : await ensureCapturesDir(folderId);
  console.log(`\u{1F4C1} Output: ${outputDir}\n`);

  console.log('\u26A0\uFE0F  Make sure the book is open to the FIRST page you want to capture.');
  console.log('   Starting capture in 3 seconds...\n');
  await sleep(3000);

  const startTime = Date.now();
  let pageNum = flags.startPage - 1;
  let duplicateCount = 0;
  let lastPagePath = null;

  while (pageNum < flags.maxPages) {
    pageNum++;
    const filename = pageImageName(pageNum);
    const filepath = path.join(outputDir, filename);

    // Capture the current window as WebP (retry once with fresh window ID)
    try {
      await captureWindowImage(windowId, filepath);
    } catch {
      console.log('  ⟳ Window ID stale, refreshing...');
      await sleep(1000);
      windowId = await getWindowIdByOwner('Books', true);
      console.log(`  New Window ID: ${windowId}`);
      await captureWindowImage(windowId, filepath);
    }

    // Check for end of book (duplicate page detection)
    if (lastPagePath) {
      try {
        const match = await imagesMatch(lastPagePath, filepath);
        if (match) {
          duplicateCount++;
          process.stdout.write(`  \u{1F4F8} ${filename} [duplicate ${duplicateCount}/${DUPLICATE_THRESHOLD}]\n`);
        } else {
          duplicateCount = 0;
          process.stdout.write(`  \u{1F4F8} ${filename}\n`);
        }
      } catch {
        duplicateCount = 0;
        process.stdout.write(`  \u{1F4F8} ${filename}\n`);
      }
    } else {
      process.stdout.write(`  \u{1F4F8} ${filename}\n`);
    }

    // Stop if we've hit the duplicate threshold
    if (duplicateCount >= DUPLICATE_THRESHOLD) {
      console.log(`\n\u{1F6D1} ${DUPLICATE_THRESHOLD} identical pages detected \u2014 end of book.`);
      // Remove duplicate pages
      for (let i = pageNum; i > pageNum - DUPLICATE_THRESHOLD; i--) {
        const dupPath = path.join(outputDir, pageImageName(i));
        await unlink(dupPath).catch(() => {});
      }
      pageNum -= DUPLICATE_THRESHOLD;
      break;
    }

    lastPagePath = filepath;

    // Advance to next page
    await sendKeystroke(nextKey);
    await sleep(PAGE_RENDER_WAIT);
  }

  if (pageNum >= flags.maxPages) {
    console.log(`\n\u26A0\uFE0F  Reached max pages limit (${flags.maxPages}).`);
  }

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  console.log(`\n\u2705 Done! ${pageNum} pages captured`);
  console.log(`\u23F1\uFE0F  Duration: ${minutes}m ${seconds}s`);
  console.log(`\u{1F4C1} Output: ${outputDir}\n`);
}

main().catch(err => {
  console.error('\u274C', err.message);
  process.exit(1);
});
