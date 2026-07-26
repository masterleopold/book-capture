# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A Claude Code plugin: captures book pages from Mac Kindle, Apple Books, Kindle Cloud Reader, PDF, or photos of a physical book, OCRs them, and generates thematic Obsidian Markdown. macOS only.

## Reference

- [README.md](README.md) — what it does, install, requirements, the eight `/book-capture:*` commands, output shape, settings fields, troubleshooting
- [docs/architecture.md](docs/architecture.md) — layers, command/agent mechanics, stage file contracts, per-source capture details, known inconsistencies
- [docs/page-images.md](docs/page-images.md) — why WebP, the migration script, photo orientation and ordering in full
- [CONTRIBUTING.md](CONTRIBUTING.md) — fork/PR flow

## Development

No build, no tests, no CI. Verification is running the thing.

```bash
bash scripts/setup.sh                  # npm install + compile vision-ocr + playwright chromium
bash scripts/setup.sh --check-only     # exit 1 if deps missing; every command runs this first
claude plugin validate ./              # manifest / frontmatter check
claude --plugin-dir ./book-capture     # load this working copy and exercise the commands
```

Scripts are ESM `.mjs` run directly with `node`, and each prints its usage on bad args — the fastest loop for anything below the prompt layer:

```bash
node scripts/import-photos.mjs <photo-dir> --output-dir <dir> --dry-run
node scripts/extract-text.mjs <captures-dir> --concurrency 5 --claude-threshold 0.6
```

`ensureVisionOCR` only checks that `scripts/vision-ocr` exists, so **after editing `vision-ocr.swift`, `rm scripts/vision-ocr` or run `setup.sh`** — only setup.sh compares mtimes. A stale binary otherwise keeps serving the old OCR silently. That binary and `scripts/node_modules/` are gitignored.

macOS is load-bearing: `screencapture`, `osascript`, inline `swift`/`swiftc`, `mdls`. Poppler (`brew install poppler`) for PDF only.

## Conventions

- **`commands/capture.md` is the canonical pipeline.** `kindle|books|cloud|pdf|photos.md` are thin wrappers over it ("follow capture.md with source = X") carrying only source-specific quirks — pipeline changes go in `capture.md`. `ocr.md` and `generate.md` restate their stages to run standalone and have drifted from it; reconcile toward `capture.md` ([details](docs/architecture.md#commands)).
- **`scripts/book-capture-utils.mjs` is the only shared module.** Every other script imports it. New system-level helpers belong there, not duplicated.
- **Use `${CLAUDE_PLUGIN_ROOT}` for every intra-plugin path in commands.** Never a relative path.
- **Bump the version in all three places together**: `.claude-plugin/plugin.json`, `skills/book-capture/SKILL.md` frontmatter, and the README badge. They currently disagree.
- Per-project settings live in `.claude/book-capture.local.md` (YAML frontmatter, auto-detected for Obsidian vaults). `.claude/` is gitignored, so it is always user-side; `templates/settings-template.md` is the documented shape.

## Pipeline contract

```
page_NNN.webp  →  raw_text.json  →  structured.json  →  NN_Theme.md + hub file
   capture         extract-text        planning            content-writer
```

Each arrow is a file, which is why `/ocr` and `/generate` run standalone. `raw_text.json` is `{ pages: [{page, text, confidence, method}], stats }`; `method` distinguishes `vision` / `vision-low` / `failed` / `claude-vision`. `extract-text.mjs` resumes by skipping page numbers already present, so re-running it is safe — delete the file to force a full re-OCR.

## Two rules that fail silently

**Pages are WebP, never PNG.** Always write them through `writePageImage`; `screencapture` and `pdftoppm` cannot emit WebP, so those paths re-encode a throwaway PNG. A page left as PNG is gitignored by the vault under `Books/files` and is therefore never preserved — the whole capture vanishes without an error. Readers still *accept* legacy PNG/JPG via `PAGE_IMAGE_RE`; only writers are WebP-only. [Why, and how to migrate an old library →](docs/page-images.md)

**Photo imports decide page order at the door.** Everything downstream assumes `page_NNN` *is* the reading order, and a phone folder does not give you that (nor an upright image — EXIF orientation must be baked in, or OCR returns empty rather than failing). Run `import-photos.mjs --dry-run` and check the mapping first: a mis-ordered import scrambles the text subtly instead of crashing. [Ordering heuristics →](docs/page-images.md#order)
