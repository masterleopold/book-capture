---
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
argument-hint: "<BookID> [--language JP|EN] [--output <path/to/file.xlsx>]"
description: "Extract key terms from existing OCR text into an XLSX spreadsheet (requires raw_text.json)"
---

# Term Spreadsheet Generation

Extract key terms from a book's OCR text and write them to an XLSX spreadsheet with three columns: **Term**, **Definition**, **Notes** (up to 3 supporting points per term).

## Setup

- `PLUGIN_SCRIPTS` = `${CLAUDE_PLUGIN_ROOT}/scripts`
- Resolve `CAPTURES_BASE` from `.claude/book-capture.local.md` or default `Books/files/book-captures`
- Parse `$ARGUMENTS` for `BookID` (positional) and optional flags:
  - `--language JP` or `--language EN` (default: `EN`)
  - `--output <path>` (default: `<OUTPUT_DIR>/terms.xlsx`)
- `OUTPUT_DIR` = `<CAPTURES_BASE>/<BookID>`

Verify OCR data exists:

```
Read: <OUTPUT_DIR>/raw_text.json
```

If not found, tell the user to run `/book-capture:ocr` first (or `/book-capture:capture` for the full pipeline).

## Step 1: Verify dependencies

Run setup if needed (installs `exceljs`):

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh" --check-only || bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh"
```

## Step 2: Dispatch the term-extractor agent

Generate a unique `SESSION_ID` (first 8 chars of random hex) so concurrent runs do not collide.

`TERMS_JSON` = `/tmp/book_terms_<SESSION_ID>.json`

Dispatch one `book-capture:term-extractor` agent with this prompt:

```
INPUT_PATH: <OUTPUT_DIR>/raw_text.json
OUTPUT_PATH: <TERMS_JSON>
LANGUAGE: <JP|EN>

Extract key terms from this book's OCR text following the rules in your agent
instructions. Write the JSON array to OUTPUT_PATH and report the term count.
```

Wait for the agent to finish.

## Step 3: Convert JSON to XLSX

Verify the agent's output exists and is non-empty:

```
Read: <TERMS_JSON>
```

Then build the spreadsheet:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-terms-xlsx.mjs" "<TERMS_JSON>" "<XLSX_OUTPUT_PATH>"
```

Where `<XLSX_OUTPUT_PATH>` is the value of `--output` if provided, otherwise `<OUTPUT_DIR>/terms.xlsx`.

## Step 4: Cleanup

Remove the temp JSON:

```bash
rm -f "<TERMS_JSON>"
```

## Step 5: Report

Report to the user:

- Number of terms extracted
- Path to the XLSX file
- A reminder that the spreadsheet has three columns (Term / Definition / Notes) and opens in Excel, Numbers, or Google Sheets

If the agent reported zero terms, surface that as a warning rather than silently producing an empty spreadsheet — likely the OCR text is empty or the book is not term-heavy.
