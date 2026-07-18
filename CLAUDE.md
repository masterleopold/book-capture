# Book Capture Plugin

Captures book pages from Mac Kindle, Apple Books, Kindle Cloud Reader, PDF files, or photos of a physical book, then extracts text via OCR and generates structured Obsidian Markdown documents organized by theme.

## Commands

- `/book-capture:capture` — Full pipeline: platform selection → screenshot capture → OCR → structured Markdown
- `/book-capture:kindle` — Capture from Mac Kindle app (source pre-selected)
- `/book-capture:books` — Capture from Apple Books app (source pre-selected)
- `/book-capture:cloud` — Capture from Kindle Cloud Reader via browser (source pre-selected)
- `/book-capture:pdf` — Capture from PDF file (source pre-selected)
- `/book-capture:photos` — Import photos of a physical book's pages (phone camera, scanner app)
- `/book-capture:ocr` — Run OCR on existing page captures (Vision + agent re-reading)
- `/book-capture:generate` — Generate structured Markdown from existing OCR text

## Agents

- `ocr-reader` — Batch multimodal OCR for low-confidence pages (reads images via Read tool)
- `content-writer` — Generates thematic Markdown content from OCR text

## Settings

Per-project settings stored in `.claude/book-capture.local.md` (YAML frontmatter). Auto-detected for Obsidian vaults.

## Dependencies

Scripts in `scripts/` require Node.js 20+ and: `playwright`, `sharp`, `run-applescript`. Run `scripts/setup.sh` to install. macOS Vision OCR requires Xcode Command Line Tools. PDF capture requires Poppler (`brew install poppler`).

## Architecture

- **Commands** define the workflow steps as instructions for Claude Code
- **Scripts** handle system-level tasks (screenshots, OCR, PDF conversion)
- **Agents** perform AI-powered tasks (image reading, content generation) within Claude Code context — no external API keys required
- Kindle Cloud Reader supports multiple regions via `--region` flag (jp, us, uk, de, fr, it, es, ca, au, in, br)

## Page images are WebP, never PNG

Pages are written as `page_NNN.webp` at 2000px/q85 via `writePageImage` in `book-capture-utils.mjs`. Every producer goes through it: `kindle-capture.mjs` screenshots to memory rather than letting Playwright write a PNG, and `capture-pdf.mjs` re-encodes what `pdftoppm` emits (it only speaks PNG) and deletes the PNGs. The window-screenshot sources — `capture-kindle-mac.mjs` (Mac Kindle) and `capture-books-app.mjs` (Apple Books) — go through `captureWindowImage`, which exists because `screencapture` cannot emit WebP: it writes a throwaway PNG to the temp dir, `writePageImage` re-encodes it, and the temp file is removed. Skip this and those two sources leave `page_NNN.png`, which the vault gitignores under `Books/files` — so an entire capture, full book or single-page excerpt, is silently never preserved.

This is not cosmetic. A retina Kindle screenshot is ~1.3MB of PNG at 3164px; 24k of them reached 31GB and filled the disk. The same pages as WebP are ~7.7GB. Accuracy does not pay for it — on identical pages Vision OCR scores the WebP the same or better (0.990 → 1.000 on the page this was measured against), because downscaling smooths the screenshot's subpixel noise. Both readers handle the format: `vision-ocr.swift` decodes it through ImageIO, and the `ocr-reader` agent's Read tool renders it.

`PAGE_IMAGE_RE` still accepts PNG/JPG so books captured before the switch keep working. To migrate one, run `compress-captures.mjs <captures-root>` — idempotent, and it moves originals aside rather than deleting them.

## Photos are a different problem from screenshots

`import-photos.mjs` covers the physical-book case: a folder of camera photos, one per page. Two things make it more than a format conversion, and both are silent when they go wrong.

**Orientation.** A phone writes the sensor's landscape pixels and tags them "rotate 90"; it does not rotate the pixels. Read such a file naively and the page is sideways, which Vision OCR returns as an empty result rather than an error. `writePageImage` calls `.rotate()` with no argument to bake the EXIF orientation in. Screenshots have no EXIF, so this costs them nothing.

**Order.** Kindle and PDF hand you pages in reading order; a photo folder hands you whatever the phone named them. OCR and the content writer both assume `page_NNN` *is* the reading order, so import fixes the order once, at the door, and renames accordingly — after which nothing downstream needs to know the book was photographed. Default order is capture time; `--order filename` exists because a re-shot page keeps its slot in the filename sequence but jumps to the end of the book in time order. Neither heuristic is always right, which is why `--dry-run` prints the full `photo -> page_NNN` mapping: a mis-ordered import yields text that is subtly scrambled rather than obviously broken.
