#!/bin/bash
# Book Capture Plugin — Setup Script
# Installs npm dependencies and compiles the vision-ocr Swift binary.
#
# Usage:
#   bash setup.sh              # Full install
#   bash setup.sh --check-only # Exit 0 if ready, 1 if not

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CHECK_ONLY=false
if [[ "${1:-}" == "--check-only" ]]; then
  CHECK_ONLY=true
fi

# Check node_modules. Reinstall if missing or if package.json was updated
# more recently than node_modules (e.g. a new dependency was added).
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  if $CHECK_ONLY; then
    echo "book-capture: npm dependencies need install/update. Run: bash ${SCRIPT_DIR}/setup.sh" >&2
    exit 1
  fi
  echo "Installing npm dependencies..."
  npm install --no-audit --no-fund
fi

# Compile vision-ocr on macOS
if [[ "$(uname)" == "Darwin" ]]; then
  if [ ! -f vision-ocr ] || [ vision-ocr.swift -nt vision-ocr ]; then
    if $CHECK_ONLY; then
      echo "book-capture: vision-ocr binary needs compiling. Run: bash ${SCRIPT_DIR}/setup.sh" >&2
      exit 1
    fi
    echo "Compiling vision-ocr.swift..."
    swiftc -O -o vision-ocr vision-ocr.swift \
      -framework Vision \
      -framework CoreGraphics \
      -framework ImageIO
    echo "Compiled vision-ocr binary."
  fi
fi

if $CHECK_ONLY; then
  exit 0
fi

# Install Playwright Chromium (for Kindle Cloud Reader capture)
# Check if chromium browser binary exists via node rather than --dry-run (more reliable)
CHROMIUM_INSTALLED=$(node -e "
  try {
    const { chromium } = require('playwright');
    const path = chromium.executablePath();
    const fs = require('fs');
    if (fs.existsSync(path)) { console.log('yes'); } else { console.log('no'); }
  } catch { console.log('no'); }
" 2>/dev/null)
if [ "$CHROMIUM_INSTALLED" != "yes" ]; then
  echo "Installing Playwright Chromium browser..."
  npx playwright install chromium
fi

echo "Setup complete."
