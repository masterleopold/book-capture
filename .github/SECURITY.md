# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Book Capture, please report it responsibly:

1. **Do NOT** open a public issue
2. Email security concerns to the maintainer via GitHub
3. Include steps to reproduce and potential impact

We will respond within 48 hours and work on a fix promptly.

## Scope

Book Capture is a Claude Code plugin that captures book pages and processes them locally. Security concerns include:
- Unintended data exposure in OCR output files
- Command injection via script arguments
- Accessibility permission abuse
- Sensitive content in captured screenshots

## Local Data

- **Captured screenshots** are stored in `Books/files/book-captures/` (or your configured captures directory). These contain full page images of copyrighted books — do not commit or share them.
- **OCR batch files** are written to `/tmp/ocr_batch_*` during processing and cleaned up after merging. They contain extracted book text.
- **Kindle Cloud Reader** uses a persistent browser profile at `~/.kindle-capture-profile` which stores Amazon session cookies. Delete this directory to clear stored credentials: `rm -rf ~/.kindle-capture-profile`
