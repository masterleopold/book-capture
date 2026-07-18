/**
 * Mac Kindle App Screenshot Capture
 *
 * Captures all pages of a book from the Mac Kindle app as screenshots.
 * Uses AppleScript for app control and screencapture for window capture.
 *
 * Usage: node capture-kindle-mac.mjs <BookID> [--horizontal] [--max-pages 500]
 *
 * Prerequisites:
 *   - macOS Accessibility permission for Terminal
 *   - Kindle app installed and book already open
 */

import { unlink } from 'fs/promises';
import path from 'path';
import {
  activateApp,
  captureWindowImage,
  ensureCapturesDir,
  getWindowIdByOwner,
  getWindowBounds,
  imagesMatch,
  pageImageName,
  parseArgs,
  sendKeystroke,
  sleep,
  runAppleScriptLines,
} from './book-capture-utils.mjs';

const APP_NAME = 'Amazon Kindle';
const PAGE_RENDER_WAIT = 2000;
const DUPLICATE_THRESHOLD = 3; // consecutive identical pages = end of book

async function main() {
  const { positional, flags } = parseArgs();
  const bookId = positional[0];

  if (!bookId) {
    console.error('Usage: node capture-kindle-mac.mjs <BookID> [--horizontal] [--max-pages 500] [--output-dir <path>]');
    process.exit(1);
  }

  const direction = flags.horizontal ? 'horizontal (LTR)' : 'vertical (RTL)';
  // Kindle Mac app doesn't respond to arrow keys for page turns; use Page Down
  const nextKey = 'page down';

  console.log(`\u{1F4D6} Mac Kindle Capture \u2014 Book: ${bookId}`);
  console.log(`\u{1F4D0} Direction: ${direction}`);
  console.log(`\u{1F4C4} Max pages: ${flags.maxPages}\n`);

  // Activate Kindle app
  console.log('Activating Kindle app...');
  await activateApp(APP_NAME);
  await sleep(1000);

  // Get window ID
  let windowId;
  try {
    windowId = await getWindowIdByOwner('Kindle');
    console.log(`Window ID: ${windowId}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Setup output directory (--output-dir overrides default)
  const outputDir = flags.outputDir
    ? await (async () => { const { mkdir } = await import('fs/promises'); const d = path.resolve(flags.outputDir); await mkdir(d, { recursive: true }); return d; })()
    : await ensureCapturesDir(bookId);
  console.log(`\u{1F4C1} Output: ${outputDir}\n`);

  // Focus the reading area: click left edge (avoids triggering Kindle center overlay)
  // then press Escape to dismiss any lingering UI elements
  console.log('Focusing reading area (click left edge + Escape)...');
  try {
    const bounds = await getWindowBounds('Kindle');
    if (bounds) {
      // Click left 1/5 of the window, vertically centered (avoids center overlay)
      const clickX = bounds.x + Math.round(bounds.width * 0.15);
      const clickY = bounds.y + Math.round(bounds.height * 0.5);
      await runAppleScriptLines([
        'tell application "System Events"',
        `  click at {${clickX}, ${clickY}}`,
        'end tell',
      ]);
      console.log(`Clicked reading area at (${clickX}, ${clickY})`);
      await sleep(500);
      // Dismiss any overlays
      await sendKeystroke('escape');
      await sleep(500);
      await sendKeystroke('escape');
      await sleep(500);
    }
  } catch (err) {
    console.log(`Warning: Could not click reading area: ${err.message}`);
    console.log('Continuing anyway — if pages don\'t advance, click the reading area manually.');
  }

  console.log('\u26A0\uFE0F  Make sure the book is open to the FIRST page you want to capture.');
  console.log('   Starting capture in 3 seconds...\n');
  await sleep(3000);

  const startTime = Date.now();
  let pageNum = 0;
  let duplicateCount = 0;
  let lastPagePath = null;

  while (pageNum < flags.maxPages) {
    pageNum++;
    const filename = pageImageName(pageNum);
    const filepath = path.join(outputDir, filename);

    // Capture the current window as WebP
    await captureWindowImage(windowId, filepath);

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
