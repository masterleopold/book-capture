---
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
argument-hint: "<photo-dir> <BookID> [--order time|filename]"
description: "Import phone photos of book pages, OCR, and generate structured Markdown"
---

# Photo Book Capture

Source is pre-selected: **photos** (a folder of camera photos — phone, scanner app — one per page).

Follow the full pipeline in `${CLAUDE_PLUGIN_ROOT}/commands/capture.md` with source = `photos`. Skip the platform selection step; there is no browser and no login.

**Photo-specific notes:**

- HEIC is read directly (an iPhone's default), alongside JPEG/PNG/TIFF. No pre-conversion step.
- Photos are rotated upright from their EXIF orientation. A phone stores the sensor's landscape pixels with a "rotate me" tag; ignore it and every page is sideways, which OCR reads as nothing.
- **Order is the pipeline's weak point here.** Kindle and PDF pages arrive in reading order for free; a photo folder does not. Import decides the order once, renames to `page_NNN.webp`, and everything downstream (`/ocr`, `/generate`) then behaves exactly as for a captured book.
  - `--order time` (default) — the photo's capture time, which is what you want when the filenames are unhelpful.
  - `--order filename` — natural sort (`IMG_9` before `IMG_10`). Use this when a page was re-shot: it keeps its slot in the sequence, whereas in time order it jumps to the end of the book.
- Originals are never modified or moved. The import writes WebP copies into the output directory.
- **Check the page order before running OCR.** Pass `--dry-run` first to print the `photo -> page_NNN` mapping, and confirm the first and last pages are the ones you expect. A mis-ordered import produces a book whose text is subtly scrambled, which is far harder to notice later than a crash.

```bash
# Preview the ordering first
node "${CLAUDE_PLUGIN_ROOT}/scripts/import-photos.mjs" "<photo-dir>" --output-dir "<OUTPUT_DIR>" --dry-run

# Then import
node "${CLAUDE_PLUGIN_ROOT}/scripts/import-photos.mjs" "<photo-dir>" --output-dir "<OUTPUT_DIR>" [--order time|filename]
```

Photos already sitting in the captures tree (copied in by hand, rather than imported) can be compressed in place instead — this keeps their filenames, so use it only where nothing links to the images:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/compress-captures.mjs" "<captures-root>" --dry-run
```
