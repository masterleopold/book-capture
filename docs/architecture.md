# Architecture

How the plugin is put together, below the level [CLAUDE.md](../CLAUDE.md) summarizes. For the user-facing tour, see [README.md](../README.md).

## Two layers, joined only by files on disk

**Prompt layer** — `commands/`, `agents/`, `skills/`. Markdown instructions Claude Code executes. Not code: nothing imports them, nothing tests them.

**Script layer** — `scripts/`. Node ESM doing the system-level work that a prompt cannot: window capture, key events, image encoding, Vision OCR.

The two never call each other directly. Commands shell out to scripts and read back what the scripts left on disk. That is also why the agents are invisible to `scripts/` — an agent is dispatched by a command, writes JSON to a path the command chose, and the command merges it.

### Commands

`commands/capture.md` is the canonical pipeline, start to finish. `kindle.md`, `books.md`, `cloud.md`, `pdf.md`, and `photos.md` are thin wrappers: each says "follow capture.md with source = X, skip platform selection" and adds only its own quirks. A pipeline change belongs in `capture.md` and nowhere else.

`ocr.md` and `generate.md` are the exception. They restate their stages so the stages can be run standalone against an existing captures directory, which means they can drift from `capture.md` — and they have:

| | `capture.md` | `generate.md` |
|---|---|---|
| Theme count | 4–25, scaled to book size by a table | fixed 8–14 |
| Topic file length | 500+ lines, under 400 is failure | 300–600 lines |
| Agent fan-out | scaled to theme count, up to 10 | fixed 3–5 |

`capture.md` is the newer and stricter of the two; reconcile toward it when you touch either.

### Agents

Both are pinned to `model: sonnet` with `tools: [Read, Write]` only.

- `ocr-reader` — reads page images with the multimodal Read tool and transcribes them. Dispatched 4–8 at a time, ~20–30 pages each. Each writes `/tmp/ocr_batch_<SESSION_ID>_NN.json`, an array of `{page, text, confidence, method: "claude-vision"}`. The command generates `SESSION_ID` (8 hex chars) so concurrent runs cannot collide, merges the batches into `raw_text.json` replacing only the low-confidence entries, then deletes the temp files.
- `content-writer` — writes topic files directly to the vault, 2–3 themes per agent. Does not emit frontmatter; the orchestrating command adds it.

### Shared module

`scripts/book-capture-utils.mjs` is the only shared module and every other script imports it. It holds window lookup (inline Swift over `CGWindowList`), `screencapture` wrappers, AppleScript keystrokes, dHash comparison, `writePageImage`, the `vision-ocr` binary manager, PDF metadata via `pdfinfo`, and argument parsing.

## Stage boundaries

```
page_NNN.webp  →  raw_text.json  →  structured.json  →  NN_Theme.md + hub file
   capture         extract-text        planning            content-writer
```

Each arrow is a file, which is why `/ocr` and `/generate` run standalone on a directory someone else filled.

**`raw_text.json`** — `{ pages: [{ page, text, confidence, method }], stats }`, sorted by page number. `method` is one of:

| value | meaning |
|---|---|
| `vision` | Vision OCR, confidence ≥ threshold (default 0.6) and non-empty |
| `vision-low` | Vision OCR ran but scored below threshold — needs an agent re-read |
| `failed` | Vision OCR threw; text is `""`, confidence `0` |
| `claude-vision` | written by the `ocr-reader` agent |

`extract-text.mjs` resumes: it loads any existing `raw_text.json` and processes only page numbers absent from it. Re-running after a partial pass is safe and cheap. To force a full re-OCR, delete the file.

**`structured.json`** — the theme plan: `{ genre, totalPages, totalChars, themes: [{id, title, description, pageRanges, keyTopics}], bookSummary, suggestedTags }`. `generate.md` offers to reuse an existing one rather than re-planning.

## Capture sources

| Source | Mechanism | Ends when |
|---|---|---|
| Mac Kindle | `CGWindowList` → `screencapture` → Page Down | duplicate detection |
| Apple Books | `CGWindowList` → `screencapture` → arrow keys | duplicate detection |
| Cloud Reader | Playwright, persistent profile | duplicate detection |
| PDF | `pdftoppm` at `--dpi` (default 200) | page count from `pdfinfo` |
| Photos | ordered import of an existing folder | end of folder |

**Duplicate detection.** Pages are compared by a 64-bit dHash (9×8 grayscale, adjacent-pixel brightness), matching at a Hamming distance ≤ 5 — robust to a pixel or two of jitter, unlike an exact hash. Three consecutive matches mean the book ended; those trailing duplicates are then deleted, so the captured page count excludes them.

**Mac Kindle quirks.** The app is `Amazon Kindle`, not `Kindle`. Arrow keys do not turn pages; Page Down does. The script clicks 15% in from the left edge (the center triggers Kindle's overlay) and sends Escape twice before starting.

**Cloud Reader regions.** `--region` accepts `jp` (default), `us`, `uk`, `de`, `fr`, `it`, `es`, `ca`, `au`, `in`, `br`, mapping to the `read.amazon.*` domains. Login is manual: the user signs in, then signals with `touch /tmp/kindle-ready`.

**PDF.** `pdftotext` on the first five pages decides whether the PDF already has embedded text (>50 non-whitespace characters), which would make image capture plus OCR the wrong tool. Encrypted PDFs must be decrypted first (`qpdf --decrypt`).

## Known inconsistencies

Recorded rather than fixed. All still open:

1. `commands/generate.md` disagrees with `commands/capture.md` on theme count, file length, and fan-out (table above).
2. `README.md`'s architecture tree lists `scripts/generate-markdown.mjs` described as a "Direct API fallback". That file does not exist and there is no direct-API path — generation is entirely agent-driven.
3. The version string lives in three places that disagree: `.claude-plugin/plugin.json` (1.2.0), `skills/book-capture/SKILL.md` frontmatter (1.1.0), and the `README.md` badge (v1.1.0).
