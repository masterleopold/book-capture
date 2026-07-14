/**
 * PDF Page Capture — Convert PDF pages to PNG images
 *
 * Converts an image-based (scanned) PDF into individual page PNGs
 * using Poppler's pdftoppm. Output is compatible with the existing
 * OCR pipeline (extract-text.mjs expects page_NNN.png files).
 *
 * Usage: node capture-pdf.mjs <pdf-path> <BookID> [--dpi 200] [--start-page 1] [--max-pages 500] [--force]
 *
 * Prerequisites:
 *   - Poppler installed (brew install poppler)
 *   - pdftoppm, pdfinfo, pdftotext available in PATH
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { access, readdir, unlink } from 'fs/promises';
import path from 'path';
import {
  ensureCapturesDir,
  getPdfMetadata,
  parseArgs,
  parseDpiArg,
  progress,
  writePageImage,
  PAGE_IMAGE_EXT,
  PAGE_IMAGE_RE,
} from './book-capture-utils.mjs';

const execFileAsync = promisify(execFile);

async function checkPoppler() {
  try {
    await execFileAsync('pdftoppm', ['-v']);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('pdftoppm not found. Install Poppler: brew install poppler');
      process.exit(1);
    }
    // pdftoppm -v exits non-zero but prints version to stderr — that's fine
  }
}

async function hasEmbeddedText(pdfPath) {
  try {
    const { stdout } = await execFileAsync('pdftotext', [
      '-f', '1', '-l', '5', '-q', pdfPath, '-',
    ], { maxBuffer: 1024 * 1024 });
    // If pdftotext extracts >50 non-whitespace chars from first 5 pages,
    // the PDF likely has embedded text (not purely image-based)
    const textContent = stdout.replace(/\s+/g, '');
    return textContent.length > 50;
  } catch {
    return false;
  }
}

async function main() {
  const { positional, flags } = parseArgs();
  const pdfPath = positional[0];
  const bookId = positional[1];
  const dpi = parseDpiArg();
  const force = process.argv.includes('--force');

  if (!pdfPath || !bookId) {
    console.error('Usage: node capture-pdf.mjs <pdf-path> <BookID> [--dpi 200] [--start-page 1] [--max-pages 500] [--force]');
    process.exit(1);
  }

  // Verify PDF exists
  try {
    await access(pdfPath);
  } catch {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  // Check Poppler is installed
  await checkPoppler();

  // Get PDF metadata
  console.log('Reading PDF metadata...');
  const meta = await getPdfMetadata(pdfPath);
  console.log(`  Title:     ${meta.title || '(none)'}`);
  console.log(`  Author:    ${meta.author || '(none)'}`);
  console.log(`  Pages:     ${meta.pages}`);
  console.log(`  Encrypted: ${meta.encrypted}`);

  if (meta.encrypted) {
    console.error('\nPDF is encrypted. Decrypt it first or provide a non-encrypted version.');
    process.exit(1);
  }

  if (meta.pages === 0) {
    console.error('\nPDF has 0 pages or pdfinfo could not read it.');
    process.exit(1);
  }

  // Check for embedded text
  const hasText = await hasEmbeddedText(pdfPath);
  if (hasText && !force) {
    console.error('\nThis PDF appears to contain embedded text (not purely image-based).');
    console.error('The OCR pipeline is designed for scanned/image-based PDFs.');
    console.error('Use --force to proceed anyway, or extract text directly with pdftotext.');
    process.exit(1);
  }
  if (hasText && force) {
    console.log('\nWarning: PDF has embedded text but --force was specified. Proceeding with image conversion.');
  }

  // Calculate page range
  const startPage = flags.startPage;
  const endPage = Math.min(startPage + flags.maxPages - 1, meta.pages);
  const totalPages = endPage - startPage + 1;

  console.log(`\nCapture settings:`);
  console.log(`  DPI:       ${dpi}`);
  console.log(`  Pages:     ${startPage}-${endPage} (${totalPages} pages)`);
  console.log(`  Book ID:   ${bookId}\n`);

  // Setup output directory (--output-dir overrides default)
  const outputDir = flags.outputDir
    ? await (async () => { const d = path.resolve(flags.outputDir); await (await import('fs/promises')).mkdir(d, { recursive: true }); return d; })()
    : await ensureCapturesDir(bookId);
  console.log(`Output: ${outputDir}\n`);

  // Convert PDF to PNGs using pdftoppm
  // -r <dpi>   : resolution
  // -png       : PNG output format
  // -sep _     : separator between prefix and page number (page_001.png)
  // -f / -l    : first / last page
  console.log('Converting PDF pages to PNG...');
  const startTime = Date.now();

  const outputPrefix = path.join(outputDir, 'page');

  try {
    await execFileAsync('pdftoppm', [
      '-r', String(dpi),
      '-png',
      '-sep', '_',
      '-f', String(startPage),
      '-l', String(endPage),
      pdfPath,
      outputPrefix,
    ], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 600000, // 10 min timeout
    });
  } catch (err) {
    console.error(`\npdftoppm failed: ${err.message}`);
    process.exit(1);
  }

  // pdftoppm only emits PNG, so re-encode to WebP and drop the PNGs. Pages are
  // stored as WebP everywhere (see writePageImage) — a PNG left here would be
  // both ~4x larger and invisible to git, which ignores PNG in the vault.
  const pngs = (await readdir(outputDir))
    .filter(f => /^page_\d+\.png$/.test(f))
    .sort();

  console.log(`Encoding ${pngs.length} pages to WebP...`);
  for (const png of pngs) {
    const src = path.join(outputDir, png);
    const dest = path.join(outputDir, png.replace(/\.png$/, `.${PAGE_IMAGE_EXT}`));
    await writePageImage(src, dest);
    await unlink(src);
  }

  const outputFiles = (await readdir(outputDir))
    .filter(f => PAGE_IMAGE_RE.test(f))
    .sort();

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  console.log(`\nDone! ${outputFiles.length} page images created`);
  console.log(`Duration: ${minutes}m ${seconds}s`);
  console.log(`Output: ${outputDir}\n`);

  if (outputFiles.length === 0) {
    console.error('Warning: No page images were created. Check the PDF and pdftoppm output.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
