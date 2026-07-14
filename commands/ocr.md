---
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent
argument-hint: "<BookID> [--concurrency 5] [--claude-threshold 0.6]"
description: "Run OCR on existing book page captures (Vision + agent re-reading)"
---

# OCR Text Extraction

Run OCR on existing page captures. Requires `page_*` image files (WebP, or PNG for books captured before the WebP switch) to already exist in the captures directory.

## Setup

- `PLUGIN_SCRIPTS` = `${CLAUDE_PLUGIN_ROOT}/scripts`
- Resolve `CAPTURES_BASE` from `.claude/book-capture.local.md` or default `Books/files/book-captures`
- Parse `$ARGUMENTS` for BookID
- `OUTPUT_DIR` = `<CAPTURES_BASE>/<BookID>`

Verify captures exist:
```
Glob: <OUTPUT_DIR>/page_*.{webp,png}
```

If no captures found, tell the user to run `/book-capture:capture` first.

## Step 1: Vision OCR

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh" --check-only || bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"
node "${CLAUDE_PLUGIN_ROOT}/scripts/extract-text.mjs" "<OUTPUT_DIR>" --concurrency 5 --claude-threshold 0.6
```

Report stats from `raw_text.json`.

## Step 2: Agent Re-reading (if needed)

Check stats in `raw_text.json`. If `vision-low` or `failed` pages exist, ask user if they want agent re-reading.

Generate a unique `SESSION_ID` (first 8 chars of random hex) to avoid temp file collisions.

Dispatch 4-8 parallel agents (subagent_type: `book-capture:ocr-reader`), each handling ~20-30 pages. Write to `/tmp/ocr_batch_<SESSION_ID>_NN.json`.

After agents complete, merge batch results from `/tmp/ocr_batch_<SESSION_ID>_*.json` back into `raw_text.json`. Clean up temp files.

## Step 3: Report

Report final OCR stats:
- Total pages
- Vision (good) count
- Vision (low) count
- Agent-read count
- Failed count
- Average confidence
