# Page images

Everything about how a page becomes a file. Both halves of this converge on one function, `writePageImage` in `scripts/book-capture-utils.mjs`, and both fail silently when bypassed — which is why they are written down at length.

## WebP, never PNG

Pages are written as `page_NNN.webp` at 2000px / q85. Every producer goes through `writePageImage`:

| Producer | Path to WebP |
|---|---|
| `kindle-capture.mjs` (Cloud Reader) | screenshots to a memory buffer rather than letting Playwright write a PNG |
| `capture-pdf.mjs` | re-encodes what `pdftoppm` emits (it only speaks PNG), then deletes the PNGs |
| `capture-kindle-mac.mjs`, `capture-books-app.mjs` | `captureWindowImage` — writes a throwaway PNG to the temp dir, re-encodes, unlinks |
| `import-photos.mjs` | reads the camera file directly, including HEIC |
| `compress-captures.mjs` | migration sweep over an existing tree |

`captureWindowImage` exists only because `screencapture` cannot emit WebP (png/jpg/tiff/pdf only). Skip it and those two sources leave `page_NNN.png`, which the vault gitignores under `Books/files` — so an entire capture, full book or single-page excerpt, is silently never preserved. That is the failure this rule guards against.

**Why it is worth the encode.** A retina Kindle screenshot is ~1.3MB of PNG at 3164px. 24k of them reached 31GB and filled the disk; the same pages as WebP are ~7.7GB.

**Why accuracy does not pay for it.** On identical pages Vision OCR scores the WebP the same or better — 0.990 → 1.000 on the page this was measured against — because downscaling smooths the screenshot's subpixel noise. Legibility is the constraint here, not pixel fidelity: these images exist to be OCR'd, and no note embeds them.

Both readers handle the format: `vision-ocr.swift` decodes it through ImageIO, and the `ocr-reader` agent's Read tool renders it.

## Legacy formats and migration

`PAGE_IMAGE_RE` (`/^page_\d+\.(webp|png|jpe?g)$/i`) still accepts PNG and JPEG, so books captured before the switch keep OCR'ing. Only the *writers* are WebP-only.

To migrate an existing library:

```bash
node scripts/compress-captures.mjs <captures-root> --dry-run
node scripts/compress-captures.mjs <captures-root> [--stage <dir>]
```

Idempotent — a page that already has its WebP is skipped, so an interrupted pass can simply be re-run. Originals are **moved** to the staging directory, never deleted, because the compression is lossy and irreversible; the caller decides when to discard the archive.

Point it at a captures tree, not a notes folder. It rewrites images to a new extension while keeping the basename, so an attachment embedded somewhere as `![[diagram.png]]` would survive on disk under a name nothing links to. Capture trees are safe precisely because no Markdown references them.

## Photos are a different problem from screenshots

`import-photos.mjs` covers the physical-book case: a folder of camera photos, one per page. Two things make it more than a format conversion, and both are silent when they go wrong.

### Orientation

A phone writes the sensor's landscape pixels and tags them "rotate 90"; it does not rotate the pixels. Read such a file naively and the page is sideways — which Vision OCR returns as an *empty result*, not an error. `writePageImage` calls sharp's `.rotate()` with no argument, which bakes the EXIF orientation in. Screenshots carry no EXIF, so it costs them nothing.

### Order

Kindle and PDF hand you pages in reading order. A photo folder hands you whatever the phone named them, and OCR and the content writer both assume `page_NNN` *is* the reading order. So import settles the order once, at the door, and renames accordingly — after which nothing downstream needs to know the book was photographed.

- `--order time` (default) — the photo's capture time, read from Spotlight's `kMDItemContentCreationDate` (the EXIF timestamp for camera files). Undatable files keep filename order among themselves and sort last, which the script warns about rather than doing quietly. If *nothing* is datable it falls back to filename order and says so.
- `--order filename` — natural sort, so `IMG_9` precedes `IMG_10`. Use this when a page was re-shot: it keeps its slot in the filename sequence, whereas in time order it jumps to the end of the book.

Neither heuristic is always right, which is why `--dry-run` prints the full `photo -> page_NNN` mapping. Check the first and last page before running OCR: a mis-ordered import yields text that is subtly scrambled rather than obviously broken, and that is far harder to notice later than a crash.

Accepted inputs are HEIC/HEIF, JPEG, PNG, TIFF, and WebP. Originals are never modified or moved.
