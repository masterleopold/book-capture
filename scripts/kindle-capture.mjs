/**
 * Kindle Cloud Reader Screenshot Capture
 *
 * Captures all pages of a Kindle book as screenshots via Playwright.
 * Usage: node kindle-capture.mjs <ASIN> [--horizontal]
 *
 * Options:
 *   --horizontal  Use left-to-right navigation (for horizontal/横書き books)
 *                 Default is right-to-left (for vertical/縦書き Japanese books)
 *
 * Uses persistent browser profile. Signals via /tmp/kindle-ready.
 */

import { chromium } from 'playwright';
import { mkdir, access, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';

import { parseArgs, pageImageName, writePageImage } from './book-capture-utils.mjs';

// Region → Kindle Cloud Reader domain mapping
const REGION_DOMAINS = {
  jp: 'read.amazon.co.jp',
  us: 'read.amazon.com',
  uk: 'read.amazon.co.uk',
  de: 'read.amazon.de',
  fr: 'read.amazon.fr',
  it: 'read.amazon.it',
  es: 'read.amazon.es',
  ca: 'read.amazon.ca',
  au: 'read.amazon.com.au',
  in: 'read.amazon.in',
  br: 'read.amazon.com.br',
};

// Parse arguments using shared utility
const args = process.argv.slice(2);
let ASIN = '';
let HORIZONTAL = false;
let CUSTOM_OUTPUT_DIR = '';
let REGION = 'jp';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--horizontal') HORIZONTAL = true;
  else if (args[i] === '--output-dir' && args[i + 1]) CUSTOM_OUTPUT_DIR = args[++i];
  else if (args[i] === '--region' && args[i + 1]) REGION = args[++i].toLowerCase();
  else if (!args[i].startsWith('--')) ASIN = args[i];
}

if (!ASIN) {
  console.error('Usage: node kindle-capture.mjs <ASIN> [--horizontal] [--region jp] [--output-dir <path>]');
  process.exit(1);
}

const domain = REGION_DOMAINS[REGION];
if (!domain) {
  console.error(`Unknown region: ${REGION}. Valid: ${Object.keys(REGION_DOMAINS).join(', ')}`);
  process.exit(1);
}

const OUTPUT_DIR = CUSTOM_OUTPUT_DIR
  ? path.resolve(CUSTOM_OUTPUT_DIR)
  : path.join(import.meta.dirname, 'book-captures', ASIN);
const KINDLE_URL = `https://${domain}/?asin=${ASIN}`;
const USER_DATA_DIR = path.join(os.homedir(), '.kindle-capture-profile');

const PAGE_RENDER_WAIT = 2000;
const LOCATION_STUCK_THRESHOLD = 3;

// For vertical (縦書き) Japanese books, "next page" = click left chevron (RTL)
// For horizontal (横書き) books, "next page" = click right chevron (LTR)
const NEXT_SELECTOR = HORIZONTAL ? '#kr-chevron-right' : '#kr-chevron-left';
const FALLBACK_CLICK_X = HORIZONTAL ? 1216 : 64;

async function getLocation(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.footer-label');
    return el?.textContent?.trim() || '';
  });
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const startTime = Date.now();
  const direction = HORIZONTAL ? '横書き (horizontal, LTR)' : '縦書き (vertical, RTL)';

  console.log(`📖 Kindle Capture — ASIN: ${ASIN}`);
  console.log(`📐 Direction: ${direction}`);
  console.log(`🌐 Region: ${REGION} (${domain})`);
  console.log(`📁 Output: ${OUTPUT_DIR}\n`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: 'ja-JP',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('🔗 Opening Kindle Cloud Reader...');
  await page.goto(KINDLE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for user signal
  const SIGNAL_FILE = '/tmp/kindle-ready';
  await unlink(SIGNAL_FILE).catch(() => {});
  console.log('\n⏸️  Waiting for you to be ready...');
  console.log('   1. Log in to Amazon (if needed)');
  console.log('   2. Navigate to the FIRST page to capture');
  console.log('   3. Signal: touch /tmp/kindle-ready\n');
  while (true) {
    try { await access(SIGNAL_FILE); await unlink(SIGNAL_FILE); break; }
    catch { await page.waitForTimeout(1000); }
  }

  console.log('🚀 Starting capture...\n');
  await page.waitForTimeout(PAGE_RENDER_WAIT);

  const startLocation = await getLocation(page);
  console.log(`  Start: ${startLocation}\n`);

  let pageNum = 0;
  let lastLocation = '';
  let locationStuckCount = 0;

  while (true) {
    pageNum++;
    const filename = pageImageName(pageNum);
    const filepath = path.join(OUTPUT_DIR, filename);

    // Screenshot to memory, then let writePageImage downscale and encode it —
    // Playwright would otherwise write a ~1.3MB PNG straight to disk.
    const buffer = await page.screenshot({ fullPage: false });
    const bytes = await writePageImage(buffer, filepath);
    const sizeKB = (bytes / 1024).toFixed(1);

    // Location-based stuck detection
    const loc = await getLocation(page);
    if (loc && loc === lastLocation) {
      locationStuckCount++;
    } else {
      locationStuckCount = 0;
      lastLocation = loc;
    }

    process.stdout.write(`  📸 ${filename} (${sizeKB} KB) ${loc}`);
    if (locationStuckCount > 0) {
      process.stdout.write(` [stuck: ${locationStuckCount}/${LOCATION_STUCK_THRESHOLD}]`);
    }
    process.stdout.write('\n');

    if (locationStuckCount >= LOCATION_STUCK_THRESHOLD) {
      console.log(`\n🛑 Location unchanged for ${LOCATION_STUCK_THRESHOLD} pages — end of book.`);
      // Remove duplicate stuck pages
      for (let i = pageNum; i > pageNum - LOCATION_STUCK_THRESHOLD; i--) {
        await unlink(path.join(OUTPUT_DIR, pageImageName(i))).catch(() => {});
      }
      pageNum -= LOCATION_STUCK_THRESHOLD;
      break;
    }

    // Advance to next page
    try {
      await page.click(NEXT_SELECTOR, { timeout: 3000 });
    } catch {
      // Fallback: click the appropriate side of viewport
      await page.mouse.click(FALLBACK_CLICK_X, 450);
    }
    await page.waitForTimeout(PAGE_RENDER_WAIT);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  console.log(`\n✅ Done! ${pageNum} pages captured`);
  console.log(`⏱️  Duration: ${minutes}m ${seconds}s`);
  console.log(`📁 Output: ${OUTPUT_DIR}\n`);

  await context.close();
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
