---
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
argument-hint: "[source] [BookID/Title] [--horizontal] [--dpi 200]"
description: "Capture book from Mac Kindle, Apple Books, Kindle Cloud Reader, or PDF to OCR to structured Markdown"
---

# Book Capture Pipeline

Full pipeline: platform selection → screenshot capture → OCR text extraction → structured Markdown generation.

All AI-powered steps use Claude Code agents — no external API keys required.

## Setup

Resolve paths:
- `PLUGIN_SCRIPTS` = `${CLAUDE_PLUGIN_ROOT}/scripts`
- Check for `.claude/book-capture.local.md` in the current working directory — if it exists, read YAML frontmatter for `vault_root`, `captures_dir`, `entries_dir`
- If no settings file, auto-detect vault: look for `.obsidian/` in current directory or parents
- `VAULT_ROOT` = detected vault root (or current directory)
- `CAPTURES_BASE` = `<VAULT_ROOT>/<captures_dir>` (default: `Books/files/book-captures`)
- `ENTRIES_DIR` = `<VAULT_ROOT>/<entries_dir>` (default: `Books/entries`)

Ensure dependencies are installed:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh" --check-only || bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"
```

## Step 1: Gather Information

Parse `$ARGUMENTS` for optional pre-filled values. Then ask the user for any missing information.

**Platform selection** (ask first, prominently):

Present these choices:
1. **Mac Kindle** — Amazon Kindle desktop app (uses screencapture + Page Down navigation)
2. **Apple Books** — Apple Books app (uses screencapture + arrow key navigation)
3. **Kindle Cloud Reader** — Browser-based via Playwright (requires Amazon login)
4. **PDF** — Image-based/scanned PDF files (uses Poppler pdftoppm)

Map to source values: `kindle`, `books`, `cloud`, `pdf`

**Required:**
1. **Source app**: kindle / books / cloud / pdf (from platform selection above)
2. **Book ID**: ASIN (for cloud/kindle), Book Title (for books), or identifier (for pdf)
3. **Book Title**: Full title (for all sources)
4. **Author**: Author name
5. **Category**: One of the vault categories (AI, Marketing, Strategy, Finance, Management, etc.)
6. **Location**: Where topic files should live (e.g., `Knowledge/Marketing/BookTitle`)

**PDF-specific (required when source = pdf):**
- **PDF Path**: Absolute path to the PDF file

**Optional (with defaults):**
7. **Direction**: `--horizontal` for LTR books, default is RTL (vertical Japanese)
8. **Language**: JP (default) or EN
9. **URL**: Amazon URL (auto-generated from ASIN if available)
10. **DPI**: Resolution for PDF rendering (default: 200)

If the user provides arguments like `kindle B0746JCN8B` or `pdf /path/to/book.pdf MyBookID`, parse them.

## Step 2: Capture Screenshots

### Check for existing captures

```
Glob: <CAPTURES_BASE>/<BookID>/page_*.{webp,png}
```

If captures exist, ask the user: **Skip capture** (use existing) or **Re-capture** (fresh).

### Run capture based on source

Set `OUTPUT_DIR` = `<CAPTURES_BASE>/<BookID>`

**kindle** (Mac Kindle app):
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/capture-kindle-mac.mjs" <BookID> [--horizontal] --output-dir "<OUTPUT_DIR>"
```
Remind user: open the book in **Amazon Kindle** app to the first page, ensure Accessibility permission for Terminal.

**Known Kindle Mac quirks:**
- App name is `Amazon Kindle` (not `Kindle`)
- Window ID detection uses CGWindowList via inline Swift
- Page navigation uses **Page Down** key (arrow keys don't work reliably)
- Dismiss startup dialogs first (script sends Escape automatically)

**books** (Apple Books):
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/capture-books-app.mjs" "<BookTitle>" [--horizontal] --output-dir "<OUTPUT_DIR>"
```
Remind user: open the book in Apple Books to the first page, ensure Accessibility permission.

**cloud** (Kindle Cloud Reader):
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kindle-capture.mjs" <ASIN> [--horizontal] --output-dir "<OUTPUT_DIR>"
```
Run in background. Guide user through login + signal (`touch /tmp/kindle-ready`).

**pdf** (Image-based PDF):
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/capture-pdf.mjs" "<pdf-path>" <BookID> [--dpi 200] --output-dir "<OUTPUT_DIR>"
```
Prerequisites: Poppler installed (`brew install poppler`).

Monitor progress. When complete, report page count.

## Step 3: OCR Text Extraction

### 3a. Run Vision OCR (local, fast)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/extract-text.mjs" "<OUTPUT_DIR>" --concurrency 5 --claude-threshold 0.6
```

Output: `<OUTPUT_DIR>/raw_text.json` with per-page text and confidence scores.

**IMPORTANT**: macOS Vision **cannot read vertical Japanese text** — it only captures horizontal headers/footers. For vertical text books, most pages will be flagged as low-confidence.

### 3b. Re-read low-quality pages with agents

After Vision OCR completes, check the stats. If there are `vision-low` or `failed` pages (or if the book uses vertical text), dispatch agents to re-read those pages.

**For vertical text books**: Re-read ALL pages with agents.
**For horizontal books**: Only re-read pages where `method` is `vision-low` or `failed`.

Generate a unique session prefix to avoid collisions with other runs:
- `SESSION_ID` = first 8 chars of a random hex string (e.g., `a3f1b2c4`)

Dispatch 4-8 parallel agents (subagent_type: `book-capture:ocr-reader`), each handling ~20-30 pages:

```
Agent prompt:
  Book: "<BookTitle>"
  Pages: page_XXX.webp through page_YYY.webp
  Directory: <OUTPUT_DIR>
  Output: /tmp/ocr_batch_<SESSION_ID>_NN.json
```

After all agents complete, merge results back into `raw_text.json`:
- Read all `/tmp/ocr_batch_<SESSION_ID>_*.json` files
- For re-read pages, replace vision-low entries with agent entries
- Keep existing vision (good) entries unchanged
- Write merged result back to `<OUTPUT_DIR>/raw_text.json`
- Clean up: delete `/tmp/ocr_batch_<SESSION_ID>_*.json` files

## Step 4: Generate Structured Markdown

### 4a. Plan thematic structure

Read `raw_text.json` and concatenate all page text. Count total pages and total character length.

**Dynamic theme count** — determine the number of thematic categories based on content volume:

| Book size | Pages | Approx chars | Theme count |
|-----------|-------|-------------|-------------|
| Short | ~30-80 | <80K | 4-6 |
| Medium | ~80-200 | 80K-200K | 7-12 |
| Long | ~200-400 | 200K-500K | 12-18 |
| Very long | 400+ | 500K+ | 18-25 |

The goal: **each theme file must contain enough source material to produce 500+ lines of detailed Markdown**. If a theme would be too thin (<300 lines of output), merge it with a related theme. If a theme is too dense (>800 lines), split it.

Analyze to identify thematic categories organized by information type (methodology, case studies, frameworks, principles, etc.), NOT by original chapter order.

Save the plan to `<OUTPUT_DIR>/structured.json`:
```json
{
  "genre": "business-strategy",
  "totalPages": 250,
  "totalChars": 320000,
  "themes": [
    { "id": "01", "title": "Theme Name", "description": "3-5 sentences", "pageRanges": "5-20, 45-60", "keyTopics": ["topic1", "topic2"] }
  ],
  "bookSummary": "2-3 sentence summary",
  "suggestedTags": ["source/book", "type/framework", "theme/innovation"]
}
```

### 4b. Generate topic files (parallel agents)

Set `LOCATION_DIR` = `<VAULT_ROOT>/<Location>`

Dispatch parallel agents (subagent_type: `book-capture:content-writer`), each handling 2-3 themes. Scale agent count to theme count:
- 4-6 themes: 2-3 agents
- 7-12 themes: 3-5 agents
- 12-18 themes: 5-7 agents
- 18+ themes: 7-10 agents

```
Agent prompt:
  Book: "<BookTitle>"
  Genre: "<genre>"
  Language: "<Language>"
  Themes: [assigned theme objects]
  Full text: <concatenated text or relevant page ranges>
  Output directory: <LOCATION_DIR>
  Sibling themes: [all theme titles for cross-linking]
```

**STRICT COMPLETENESS RULES — non-negotiable:**
- Each topic file MUST be **500+ lines minimum**. Under 400 lines = failure. Aim for 500-800 lines.
- **Every** name, number, date, quote, statistic, framework, example, and case study from the source text MUST appear in the output. Missing information is the worst failure mode.
- **Never summarize** when you can transcribe. Include the full detail, not a condensed version.
- **All direct quotes** from the source must appear as `>` blockquotes — every single one, not a selection.
- **All frameworks and models** must be fully described with every component, not just named.
- **All comparisons** of 3+ items must be rendered as tables.
- **All step-by-step processes** must include every step with full detail.

Each agent writes topic files directly to `<LOCATION_DIR>/NN_ThemeName.md`.

**Topic file format:**
```markdown
---
tags:
  - source/book
  - type/framework
  - theme/<relevant>
parent: "[[<BookTitle>]]"
---

<Rich markdown content>
```

### 4c. Generate hub file

Write the hub file at `<ENTRIES_DIR>/<BookTitle>.md`:

```markdown
---
tags:
  - source/book
  - <suggested tags>
Category: "<Category>"
Rating: ""
author: "<Author>"
Location: "<Location>"
Chapters: <number of topics>
Language: "<Language>"
URL: "<URL>"
---

# <BookTitle>

<Book summary>

## Topics

- [[01_ThemeName]] — Description
- [[02_ThemeName]] — Description
...
```

**Filename rules:**
- Sanitize: replace `/\:*?"<>|` with `\uFF65` (U+FF65), max 80 chars
- Topic files: `NN_ThemeName.md`
- Hub file: `<BookTitle>.md` in entries directory

## Step 5: Report Results

Report:
- Total pages captured
- OCR stats (Vision good / Vision low / agent-read)
- Number of topic files generated with paths
- Hub file path
- Topic files directory
- Any issues or warnings

Suggest the user:
1. Open the hub file in Obsidian to verify
2. Review topic files for quality and completeness
3. Add a Rating to the hub file frontmatter
4. Check wikilinks are working

## Error Handling

- **npm packages not installed**: Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"`
- **Playwright not installed**: Run `cd "${CLAUDE_PLUGIN_ROOT}/scripts" && npx playwright install chromium`
- **Accessibility permission denied**: Guide to System Settings > Privacy & Security > Accessibility
- **Vision OCR compilation fails**: Check Xcode CLT (`xcode-select --install`)
- **Vision OCR misses vertical text**: Expected — dispatch agents for those pages
- **Kindle window not found**: Ensure book is open and visible
- **Capture stuck/timeout**: Use `--max-pages` limit or kill + resume OCR
- **pdftoppm not found**: Install Poppler: `brew install poppler`
- **PDF is encrypted**: Decrypt first (`qpdf --decrypt`)
