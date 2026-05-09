---
name: book-capture
description: Capture book pages from Mac Kindle, Apple Books, Kindle Cloud Reader, or PDF files, OCR them, and extract key terms into an XLSX spreadsheet (default) or generate structured Obsidian Markdown. Activates when the user mentions capturing a book, Kindle screenshots, Apple Books capture, book OCR, building a glossary or term spreadsheet from a book, or extracting text from book page images.
version: 1.1.0
---

# Book Capture Skill

This plugin captures book pages as screenshots, extracts text via OCR, and turns the result into either:

1. **A key-terms spreadsheet (XLSX)** — three columns: Term, Definition, Notes (up to 3 supporting points per term). This is the default output. Driven by the `term-extractor` agent.
2. **Structured Obsidian Markdown** — thematic topic files with wikilinks. Driven by the `content-writer` agent. Still supported.

## Available Commands

### Source-specific capture (recommended starting points)

| Command | Platform | When to use |
|---------|----------|-------------|
| `/book-capture:kindle` | Mac Kindle app | Capture from Amazon Kindle desktop app |
| `/book-capture:books` | Apple Books | Capture from Apple Books app |
| `/book-capture:cloud` | Kindle Cloud Reader | Capture via browser (Playwright) |
| `/book-capture:pdf` | PDF file | Capture from scanned/image-based PDF |

### Pipeline steps

| Command | Purpose | When to use |
|---------|---------|-------------|
| `/book-capture:capture` | Full pipeline with platform selection | When the source is not yet decided |
| `/book-capture:ocr` | OCR only | Page screenshots already exist, need text extraction |
| `/book-capture:terms` | **Key-terms XLSX (default output)** | OCR text exists (`raw_text.json`); produce a glossary spreadsheet |
| `/book-capture:generate` | Structured Markdown (legacy/optional) | OCR text exists; produce themed Obsidian Markdown instead of a spreadsheet |

## Quick Start

If the user wants to **capture a book and get a terms spreadsheet** (the default flow):

1. `/book-capture:capture` (or a source-specific command) — captures pages and runs OCR.
2. `/book-capture:terms <BookID>` — extracts terms and writes `terms.xlsx`.

If the user already has page screenshots, start at `/book-capture:ocr` and then `/book-capture:terms`.

If the user explicitly wants the older themed-Markdown output instead of (or in addition to) the spreadsheet, swap `/book-capture:terms` for `/book-capture:generate`.

## Platform Support

| Platform | Source ID | Key requirement |
|----------|-----------|-----------------|
| **Mac Kindle** | `kindle` | Amazon Kindle app open with book, Accessibility permission |
| **Apple Books** | `books` | Apple Books app open with book, Accessibility permission |
| **Kindle Cloud Reader** | `cloud` | Playwright browser, Amazon login |
| **PDF** | `pdf` | Poppler installed (`brew install poppler`) |

## Agents

| Agent | Role |
|-------|------|
| `book-capture:ocr-reader` | Multimodal re-read of low-confidence page screenshots |
| `book-capture:term-extractor` | Extracts key terms from OCR text into structured JSON for spreadsheet output |
| `book-capture:content-writer` | Generates themed Obsidian Markdown from OCR text (legacy flow) |

## Prerequisites

- **macOS** (required for screencapture and Vision OCR)
- **Node.js 20+**
- **Xcode Command Line Tools** (for Vision OCR Swift compilation)
- **Accessibility permission** for Terminal/Claude Code (for Kindle and Apple Books)
- **Poppler** (only for PDF source: `brew install poppler`)
- `scripts/setup.sh` installs Node dependencies including `exceljs` (used to build the XLSX).

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
