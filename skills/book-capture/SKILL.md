---
name: book-capture
description: Capture book pages from Mac Kindle, Apple Books, Kindle Cloud Reader, PDF files, or photos of a physical book, then OCR and generate structured Obsidian Markdown. Activates when user mentions capturing a book, Kindle screenshots, Apple Books capture, book OCR, book-to-markdown conversion, photographing a paper book, importing page photos, or extracting text from book page images.
version: 1.1.0
---

# Book Capture Skill

This plugin captures book pages as images, extracts text via OCR, and generates structured Obsidian Markdown documents organized by theme. Pages are stored as WebP (2000px, q85) — a quarter of PNG's bytes, and OCR scores it the same or better.

## Available Commands

### Source-specific (recommended)

| Command | Platform | When to use |
|---------|----------|-------------|
| `/book-capture:kindle` | Mac Kindle app | Capture from Amazon Kindle desktop app |
| `/book-capture:books` | Apple Books | Capture from Apple Books app |
| `/book-capture:cloud` | Kindle Cloud Reader | Capture via browser (Playwright) |
| `/book-capture:pdf` | PDF file | Capture from scanned/image-based PDF |
| `/book-capture:photos` | Photos | Import photos of a physical book's pages |

### Pipeline steps

| Command | Purpose | When to use |
|---------|---------|-------------|
| `/book-capture:capture` | Full pipeline with platform selection | When source is not yet decided |
| `/book-capture:ocr` | OCR only | Page images already exist, need text extraction |
| `/book-capture:generate` | Markdown only | OCR text exists (`raw_text.json`), need structured docs |

## Platform Support

| Platform | Source ID | Key requirement |
|----------|-----------|-----------------|
| **Mac Kindle** | `kindle` | Amazon Kindle app open with book, Accessibility permission |
| **Apple Books** | `books` | Apple Books app open with book, Accessibility permission |
| **Kindle Cloud Reader** | `cloud` | Playwright browser, Amazon login |
| **PDF** | `pdf` | Poppler installed (`brew install poppler`) |
| **Photos** | `photos` | A folder of page photos (HEIC/JPEG), one per page |

Photos are the one source where page order is not given to you. The importer decides it (capture time by default, `--order filename` otherwise) and renames to `page_NNN.webp`, so everything downstream behaves as it does for a captured book. Preview with `--dry-run` before OCR: a mis-ordered import scrambles the text subtly rather than failing loudly.

## Quick Start

If the user wants to capture a book, invoke `/book-capture:capture`. It will ask for the platform and all required information.

If the user already has page screenshots and just needs OCR + markdown, use `/book-capture:ocr` followed by `/book-capture:generate`.

## Prerequisites

- **macOS** (required for screencapture and Vision OCR)
- **Node.js 20+**
- **Xcode Command Line Tools** (for Vision OCR Swift compilation)
- **Accessibility permission** for Terminal/Claude Code (for Kindle and Apple Books)
- **Poppler** (only for PDF source: `brew install poppler`)

## Settings

Per-project settings in `.claude/book-capture.local.md`:
```yaml
---
vault_root: /path/to/obsidian/vault
captures_dir: Books/files/book-captures
entries_dir: Books/entries
default_source: kindle
default_language: JP
default_dpi: 200
---
```
