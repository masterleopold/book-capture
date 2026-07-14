# Book Capture

[![release](https://img.shields.io/badge/release-v1.1.0-blue)](https://github.com/masterleopold/book-capture/releases) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Claude Code](https://img.shields.io/badge/Claude%20Code-Plugin-blueviolet)](https://docs.anthropic.com/en/docs/claude-code)

> Capture books from Kindle, Apple Books, or PDF — then OCR and generate structured Markdown.

A Claude Code plugin that captures book pages as screenshots, extracts text via OCR, and generates thematically organized Markdown documents. Built for [Obsidian](https://obsidian.md) knowledge vaults but works with any Markdown-based system.

## What It Does

1. **Captures** every page of a book as screenshots (Mac Kindle, Apple Books, Kindle Cloud Reader, or PDF)
2. **Extracts text** via macOS Vision OCR + Claude Code agents for low-confidence pages
3. **Generates** 8-14 thematically organized Markdown files with rich formatting (tables, blockquotes, cross-references)
4. **Creates** a hub file with frontmatter and wikilinks to all topic files

The entire pipeline runs locally with no external API keys — OCR and content generation use Claude Code's built-in capabilities.

## Supported Platforms

| Platform | How It Works | Best For |
|----------|-------------|----------|
| **Mac Kindle** | CGWindowList + screencapture + Page Down | Kindle purchases |
| **Apple Books** | CGWindowList + screencapture + arrow keys | Apple Books purchases |
| **Kindle Cloud Reader** | Playwright browser automation | When desktop app unavailable |
| **PDF** | Poppler pdftoppm conversion | Scanned/image-based PDFs |
| **Photos** | Ordered import of camera photos (HEIC/JPEG) | Physical books shot page by page |

## Installation

### Install from GitHub (recommended)

In Claude Code, run:

```
/plugins
```

1. Navigate to the **Marketplaces** tab
2. Select **Add marketplace** and enter: `masterleopold/book-capture`
3. Navigate to the **Discover** tab
4. Find **book-capture** and install it

After installation, the commands are available in every Claude Code session.

| Scope | Effect |
|---|---|
| **user** (default) | Available in all your projects |
| **project** | Shared with your team via `.claude/settings.json` |

### Try It (one-time)

```bash
git clone https://github.com/masterleopold/book-capture.git
claude --plugin-dir ./book-capture
```

### First-Time Setup

After installing, run the setup script to install Node.js dependencies and compile the Vision OCR binary:

```bash
bash ~/.claude/plugins/cache/book-capture-marketplace/book-capture/*/scripts/setup.sh
```

Or the plugin will auto-detect and prompt you on first use.

### Requirements

- **macOS** (required for screencapture and Vision OCR)
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** CLI installed and authenticated
- **Node.js 20+**
- **Xcode Command Line Tools** (`xcode-select --install`)
- **Accessibility permission** for Terminal/Claude Code (System Settings > Privacy & Security > Accessibility)
- **Poppler** (PDF only): `brew install poppler`

## Commands

### Source-Specific (recommended)

| Command | Platform | Description |
|---------|----------|-------------|
| `/book-capture:kindle` | Mac Kindle | Capture from Amazon Kindle desktop app |
| `/book-capture:books` | Apple Books | Capture from Apple Books app |
| `/book-capture:cloud` | Kindle Cloud Reader | Capture via browser (Playwright) |
| `/book-capture:pdf` | PDF file | Capture from scanned/image-based PDF |
| `/book-capture:photos` | Photos | Import photos of a physical book's pages |

### Pipeline Steps

| Command | Description |
|---------|-------------|
| `/book-capture:capture` | Full pipeline with platform selection prompt |
| `/book-capture:ocr` | OCR only on existing page captures |
| `/book-capture:generate` | Markdown generation from existing OCR text |

### Page Images

Pages are stored as WebP (2000px, q85), not PNG. A retina screenshot is ~1.3MB of PNG; a large library of them runs to tens of GB. The same pages as WebP cost about a quarter of that, and OCR does not pay for it — on identical pages Vision scores the WebP the same or better, because downscaling smooths the screenshot's subpixel noise.

Books captured before this change still OCR: PNG and JPEG are read wherever pages are read. To convert an existing library, run `scripts/compress-captures.mjs <captures-root>` — it is idempotent, and moves originals aside rather than deleting them.

## Quick Start

```
/book-capture:kindle B0883TQ3ZN
```

Claude Code will:
1. Ask for book title, author, category, and location
2. Remind you to open the book in Kindle to the first page
3. Capture all pages (auto-stops at end of book)
4. Run Vision OCR + agent re-reading for low-confidence pages
5. Analyze content and create 8-14 thematic topic files
6. Generate a hub file with wikilinks

## How It Works

### Screenshot Capture

Each platform uses macOS-native tools:
- **CGWindowList** (via inline Swift) to find the app window ID
- **screencapture** to capture individual window frames
- **AppleScript** to control page navigation (Page Down for Kindle, arrow keys for Books)
- **Duplicate detection** to auto-stop at end of book (3 consecutive identical pages)

### OCR Pipeline

1. **macOS Vision OCR** (fast, local) processes all pages with confidence scoring
2. Pages below the confidence threshold are re-read by **Claude Code agents** using multimodal image reading
3. Results are merged into `raw_text.json`

Note: macOS Vision cannot read vertical Japanese text (tategaki). For vertical text books, all pages are re-read by agents.

### Markdown Generation

1. Claude Code analyzes the full text and identifies **8-14 thematic categories** (organized by information type, not original chapter order)
2. **Parallel agents** generate detailed topic files (300-600 lines each) with:
   - Genre-specific structure (business, technical, humanities, science, narrative)
   - Tables, blockquotes, bold key terms, cross-references
   - `[[wikilinks]]` between sibling topics
3. A **hub file** is created with frontmatter and links to all topics

## Output Structure

```
Books/entries/BookTitle.md              # Hub file with frontmatter
Knowledge/Category/BookTitle/
  01_Theme_Name.md                      # Topic file (300-600 lines)
  02_Theme_Name.md
  ...
  10_Theme_Name.md
```

### Hub File Example

```markdown
---
tags:
  - source/book
  - type/framework
  - theme/fundraising
Category: "Startup"
Rating: ""
author: "Author Name"
Location: "Knowledge/Startup/BookTitle"
Chapters: 10
Language: "EN"
URL: "https://www.amazon.co.jp/dp/B0883TQ3ZN"
---

# Book Title

Book summary (2-3 sentences).

## Topics

- [[01_Theme Name]] - Description
- [[02_Theme Name]] - Description
...
```

## Configuration

Per-project settings via `.claude/book-capture.local.md`:

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

If no settings file exists, the plugin auto-detects Obsidian vaults by looking for `.obsidian/` in the current directory or parents.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Kindle window not found | Ensure book is open and visible in Amazon Kindle app |
| Accessibility denied | System Settings > Privacy & Security > Accessibility > add Terminal |
| Vision OCR compilation fails | `xcode-select --install` |
| Vision OCR misses vertical text | Expected for tategaki — agents handle these pages |
| Pages don't advance | Kindle uses Page Down key; restart the app if stuck |
| pdftoppm not found | `brew install poppler` |
| PDF is encrypted | `qpdf --decrypt input.pdf output.pdf` |
| npm packages not installed | Run `scripts/setup.sh` |

## Architecture

```
book-capture/
  .claude-plugin/
    plugin.json           # Plugin manifest
    marketplace.json      # Marketplace metadata
  commands/               # 7 slash commands
    kindle.md             # /book-capture:kindle
    books.md              # /book-capture:books
    cloud.md              # /book-capture:cloud
    pdf.md                # /book-capture:pdf
    capture.md            # /book-capture:capture (generic)
    ocr.md                # /book-capture:ocr
    generate.md           # /book-capture:generate
  agents/
    ocr-reader.md         # Multimodal OCR re-reader
    content-writer.md     # Thematic content generator
  skills/
    book-capture/
      SKILL.md            # Auto-activating skill
  scripts/
    capture-kindle-mac.mjs
    capture-books-app.mjs
    kindle-capture.mjs    # Playwright Cloud Reader
    capture-pdf.mjs
    extract-text.mjs      # Vision OCR
    generate-markdown.mjs # Direct API fallback
    book-capture-utils.mjs
    vision-ocr.swift      # macOS Vision CLI
    setup.sh              # Dependency installer
    package.json
  templates/
    settings-template.md
```

## License

[MIT](LICENSE)
