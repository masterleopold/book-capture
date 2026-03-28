/**
 * Book Capture — Shared Utilities
 *
 * Common helpers for the book capture workflow:
 * - Filename sanitization
 * - screencapture wrapper
 * - AppleScript execution
 * - Image similarity comparison (end-of-book detection)
 * - vision-ocr binary management
 */

import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { access, mkdir, readFile } from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Base directory for all capture scripts
export const FILES_DIR = import.meta.dirname;
export const CAPTURES_DIR = process.env.BOOK_CAPTURES_DIR || path.join(FILES_DIR, 'book-captures');

// ─── Filename Sanitization ───────────────────────────────────────────────

const INVALID_CHARS = /[\/\\:*?"<>|]/g;
const MAX_FILENAME_LEN = 80;

/**
 * Sanitize a string for use as a filename.
 * Replaces invalid characters with ･ (U+FF65), trims to 80 chars.
 */
export function sanitizeFilename(name) {
  let sanitized = name.replace(INVALID_CHARS, '\uFF65').trim();
  if (sanitized.length > MAX_FILENAME_LEN) {
    sanitized = sanitized.slice(0, MAX_FILENAME_LEN);
  }
  return sanitized;
}

// ─── AppleScript Execution ───────────────────────────────────────────────

/**
 * Run an AppleScript string and return stdout.
 */
export async function runAppleScript(script) {
  const { stdout } = await execAsync(`osascript -e ${escapeShell(script)}`);
  return stdout.trim();
}

/**
 * Run a multi-line AppleScript (passed as array of lines).
 */
export async function runAppleScriptLines(lines) {
  const args = lines.flatMap(line => ['-e', line]);
  const { stdout } = await execFileAsync('osascript', args);
  return stdout.trim();
}

function escapeShell(str) {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Sanitize a string for safe interpolation into Swift source code.
 * Removes backslashes, double quotes, and non-ASCII control characters.
 */
export function sanitizeSwiftString(str) {
  return str.replace(/[\\"]/g, '').replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, '');
}

// ─── Screen Capture ──────────────────────────────────────────────────────

/**
 * Capture a specific window by its windowID.
 * Uses macOS screencapture with -l (window ID) and -x (silent).
 */
export async function captureWindow(windowId, outputPath) {
  await execFileAsync('screencapture', ['-l', String(windowId), '-x', outputPath]);
}

/**
 * Get the window ID of the frontmost window of an application.
 */
export async function getWindowId(appName) {
  const script = [
    `tell application "System Events"`,
    `  tell process "${appName}"`,
    `    set frontWindow to first window`,
    `    return id of frontWindow`,
    `  end tell`,
    `end tell`,
  ];
  return runAppleScriptLines(script);
}

/**
 * Activate an application and bring it to the front.
 */
export async function activateApp(appName) {
  await runAppleScript(`tell application "${appName}" to activate`);
  await sleep(1000); // Wait for app to come to front
}

/**
 * Send a keystroke to the frontmost application.
 * @param {string} key - Key name (e.g., 'right arrow', 'left arrow')
 * @param {object} [modifiers] - Optional modifiers { command: true, shift: true }
 */
export async function sendKeystroke(key, modifiers = {}) {
  const modList = [];
  if (modifiers.command) modList.push('command down');
  if (modifiers.shift) modList.push('shift down');
  if (modifiers.option) modList.push('option down');
  if (modifiers.control) modList.push('control down');

  const using = modList.length > 0
    ? ` using {${modList.join(', ')}}`
    : '';

  const script = [
    'tell application "System Events"',
    `  key code ${getKeyCode(key)}${using}`,
    'end tell',
  ];
  await runAppleScriptLines(script);
}

/**
 * Send a keystroke by character to the frontmost application.
 */
export async function sendKey(character) {
  const script = [
    'tell application "System Events"',
    `  keystroke "${character}"`,
    'end tell',
  ];
  await runAppleScriptLines(script);
}

// macOS virtual key codes
const KEY_CODES = {
  'right arrow': 124,
  'left arrow': 123,
  'down arrow': 125,
  'up arrow': 126,
  'page down': 121,
  'page up': 116,
  'return': 36,
  'space': 49,
  'escape': 53,
};

function getKeyCode(keyName) {
  const code = KEY_CODES[keyName.toLowerCase()];
  if (code === undefined) throw new Error(`Unknown key: ${keyName}`);
  return code;
}

// ─── Image Comparison ────────────────────────────────────────────────────

/**
 * Compute a difference hash (dHash) of an image file using sharp.
 * Returns a BigInt representing a 64-bit perceptual hash.
 * dHash is robust against minor shifts — it compares adjacent pixel
 * brightness rather than absolute pixel values.
 */
export async function imageHash(filePath) {
  const sharp = (await import('sharp')).default;
  // Resize to 9x8 grayscale (9 wide so we get 8 horizontal differences)
  const { data } = await sharp(filePath)
    .resize(9, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      if (left > right) {
        hash |= 1n << BigInt(row * 8 + col);
      }
    }
  }
  return hash;
}

/**
 * Compute the hamming distance between two 64-bit dHash values.
 */
function hammingDistance(a, b) {
  let xor = a ^ b;
  let dist = 0;
  while (xor > 0n) {
    dist += Number(xor & 1n);
    xor >>= 1n;
  }
  return dist;
}

/** Maximum hamming distance to consider two images as matching. */
const DHASH_MATCH_THRESHOLD = 5;

/**
 * Compare two images by perceptual dHash.
 * Returns true if they are identical or nearly identical
 * (hamming distance <= threshold).
 */
export async function imagesMatch(pathA, pathB) {
  const [hashA, hashB] = await Promise.all([
    imageHash(pathA),
    imageHash(pathB),
  ]);
  return hammingDistance(hashA, hashB) <= DHASH_MATCH_THRESHOLD;
}

// ─── Window Management (CGWindowList) ───────────────────────────────────

/**
 * Get the CGWindowID of the largest on-screen window matching a name pattern.
 * Uses inline Swift to query CGWindowList — more reliable than AppleScript
 * for apps that don't expose window IDs via the scripting bridge.
 *
 * @param {string} ownerPattern - Substring to match against window owner name
 *   (e.g., "Kindle" matches "Amazon Kindle", "Books" matches exactly)
 * @param {boolean} [exact=false] - If true, match owner name exactly
 * @returns {Promise<string>} The window ID as a string
 * @throws {Error} If no matching window is found or Swift execution fails
 */
export async function getWindowIdByOwner(ownerPattern, exact = false) {
  const comparison = exact
    ? `owner == "${ownerPattern}"`
    : `owner.contains("${ownerPattern}")`;

  const swiftCode = `
import CoreGraphics
let windowList = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
var best: (Int, Int) = (0, 0)
for w in windowList {
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    if ${comparison} {
        let wid = w[kCGWindowNumber as String] as? Int ?? 0
        let bounds = w[kCGWindowBounds as String] as? [String:Any] ?? [:]
        let width = bounds["Width"] as? Int ?? 0
        let height = bounds["Height"] as? Int ?? 0
        let area = width * height
        if area > best.1 { best = (wid, area) }
    }
}
if best.0 > 0 { print(best.0) }
else { fputs("No window found matching '${ownerPattern}'\\n", stderr); exit(1) }
`;
  try {
    const { stdout } = await execFileAsync('swift', ['-e', swiftCode], { timeout: 10000 });
    return stdout.trim();
  } catch (err) {
    const stderr = err.stderr || '';
    if (stderr.includes('No window found')) {
      throw new Error(`No window found for "${ownerPattern}". Is the app open with a book visible?`);
    }
    throw new Error(`Failed to query windows for "${ownerPattern}": ${stderr || err.message}`);
  }
}

/**
 * Get the bounds {x, y, width, height} of the largest on-screen window matching a name pattern.
 */
export async function getWindowBounds(ownerPattern) {
  const swiftCode = `
import CoreGraphics
let windowList = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
for w in windowList {
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    if owner.contains("${ownerPattern}") {
        let bounds = w[kCGWindowBounds as String] as? [String:Any] ?? [:]
        let x = bounds["X"] as? Int ?? 0
        let y = bounds["Y"] as? Int ?? 0
        let width = bounds["Width"] as? Int ?? 0
        let height = bounds["Height"] as? Int ?? 0
        if width * height > 10000 {
            print("\\(x),\\(y),\\(width),\\(height)")
            break
        }
    }
}
`;
  try {
    const { stdout } = await execFileAsync('swift', ['-e', swiftCode], { timeout: 10000 });
    const parts = stdout.trim().split(',').map(Number);
    if (parts.length === 4 && parts[2] > 0) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Vision OCR Binary Management ────────────────────────────────────────

const SWIFT_SOURCE = path.join(FILES_DIR, 'vision-ocr.swift');
const SWIFT_BINARY = path.join(FILES_DIR, 'vision-ocr');

/**
 * Ensure the vision-ocr binary exists. Compile from Swift source if needed.
 */
export async function ensureVisionOCR() {
  try {
    await access(SWIFT_BINARY);
    return SWIFT_BINARY;
  } catch {
    console.log('Compiling vision-ocr.swift...');
    await execFileAsync('swiftc', [
      '-O',                     // Optimize
      '-o', SWIFT_BINARY,
      SWIFT_SOURCE,
      '-framework', 'Vision',
      '-framework', 'CoreGraphics',
      '-framework', 'ImageIO',
    ]);
    console.log('Compiled vision-ocr binary.');
    return SWIFT_BINARY;
  }
}

/**
 * Run vision-ocr on an image file and return parsed JSON result.
 */
export async function runVisionOCR(imagePath, languages = ['ja', 'en']) {
  const binary = await ensureVisionOCR();
  const { stdout, stderr } = await execFileAsync(binary, [
    imagePath,
    '--lang', languages.join(','),
  ], { maxBuffer: 10 * 1024 * 1024 });

  if (stderr && stderr.includes('"error"')) {
    throw new Error(`Vision OCR error: ${stderr}`);
  }
  return JSON.parse(stdout);
}

// ─── Output Directory Management ─────────────────────────────────────────

/**
 * Create and return the captures directory for a given book ID.
 */
export async function ensureCapturesDir(bookId) {
  const dir = path.join(CAPTURES_DIR, sanitizeFilename(bookId));
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Generate a zero-padded page filename.
 */
export function pageFilename(pageNum, ext = 'png') {
  return `page_${String(pageNum).padStart(3, '0')}.${ext}`;
}

// ─── PDF Utilities ────────────────────────────────────────────────────────

/**
 * Get PDF metadata via pdfinfo.
 * Returns { pages, title, author, encrypted }.
 */
export async function getPdfMetadata(pdfPath) {
  const { stdout } = await execFileAsync('pdfinfo', [pdfPath]);
  const get = (key) => {
    const m = stdout.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  return {
    pages: parseInt(get('Pages'), 10) || 0,
    title: get('Title'),
    author: get('Author'),
    encrypted: /yes/i.test(get('Encrypted')),
  };
}

/**
 * Parse --dpi flag from argv. Returns the DPI value or the given default.
 */
export function parseDpiArg(argv = process.argv.slice(2), defaultDpi = 200) {
  const idx = argv.indexOf('--dpi');
  if (idx !== -1 && argv[idx + 1]) {
    const val = parseInt(argv[idx + 1], 10);
    if (val > 0) return val;
  }
  return defaultDpi;
}

// ─── Misc ────────────────────────────────────────────────────────────────

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse common CLI arguments from process.argv.
 * Returns { positional: [...], flags: { horizontal: bool, maxPages: number, ... } }
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const positional = [];
  const flags = {
    horizontal: false,
    pageDown: false,
    maxPages: 500,
    startPage: 1,
    concurrency: 5,
    claudeThreshold: 0.6,
    outputDir: '',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--horizontal') {
      flags.horizontal = true;
    } else if (arg === '--page-down') {
      flags.pageDown = true;
    } else if (arg === '--max-pages' && argv[i + 1]) {
      flags.maxPages = parseInt(argv[++i], 10);
    } else if (arg === '--start-page' && argv[i + 1]) {
      flags.startPage = parseInt(argv[++i], 10);
    } else if (arg === '--concurrency' && argv[i + 1]) {
      flags.concurrency = parseInt(argv[++i], 10);
    } else if (arg === '--claude-threshold' && argv[i + 1]) {
      flags.claudeThreshold = parseFloat(argv[++i]);
    } else if (arg === '--output-dir' && argv[i + 1]) {
      flags.outputDir = argv[++i];
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

/**
 * Print a progress line (overwriting previous).
 */
export function progress(current, total, message = '') {
  const pct = ((current / total) * 100).toFixed(1);
  process.stdout.write(`\r  [${current}/${total}] ${pct}% ${message}`.padEnd(80));
  if (current === total) process.stdout.write('\n');
}
