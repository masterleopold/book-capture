# Book Capture Plugin

Captures book pages from Mac Kindle, Apple Books, Kindle Cloud Reader, or PDF files, then extracts text via OCR. Default output is an XLSX key-terms spreadsheet (Term / Definition / Notes); structured Obsidian Markdown is also supported as a secondary output.

## Commands

- `/book-capture:capture` — Full capture pipeline: platform selection → screenshot capture → OCR
- `/book-capture:kindle` — Capture from Mac Kindle app (source pre-selected)
- `/book-capture:books` — Capture from Apple Books app (source pre-selected)
- `/book-capture:cloud` — Capture from Kindle Cloud Reader via browser (source pre-selected)
- `/book-capture:pdf` — Capture from PDF file (source pre-selected)
- `/book-capture:ocr` — Run OCR on existing page captures (Vision + agent re-reading)
- `/book-capture:terms` — **Default output.** Extract key terms from OCR text into an XLSX spreadsheet
- `/book-capture:generate` — Optional alternate output. Generate structured Obsidian Markdown from OCR text

## Agents

- `ocr-reader` — Batch multimodal OCR for low-confidence pages (reads images via Read tool)
- `term-extractor` — Reads OCR text and emits structured JSON of key terms (definition + up to 3 supporting points) for XLSX conversion
- `content-writer` — Generates thematic Markdown content from OCR text (used by `/book-capture:generate`)

## Settings

Per-project settings stored in `.claude/book-capture.local.md` (YAML frontmatter). Auto-detected for Obsidian vaults.

## Dependencies

Scripts in `scripts/` require Node.js 20+ and: `playwright`, `sharp`, `run-applescript`, `exceljs`. Run `scripts/setup.sh` to install. macOS Vision OCR requires Xcode Command Line Tools. PDF capture requires Poppler (`brew install poppler`).

## Architecture

- **Commands** define the workflow steps as instructions for Claude Code
- **Scripts** handle system-level tasks (screenshots, OCR, PDF conversion)
- **Agents** perform AI-powered tasks (image reading, content generation) within Claude Code context — no external API keys required
- Kindle Cloud Reader supports multiple regions via `--region` flag (jp, us, uk, de, fr, it, es, ca, au, in, br)
