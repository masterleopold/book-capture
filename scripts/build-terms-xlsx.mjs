#!/usr/bin/env node
/**
 * build-terms-xlsx.mjs
 *
 * Reads a terms JSON file (produced by the term-extractor agent) and
 * writes an XLSX spreadsheet with five columns:
 * Term, Category, Definition, Notes, Examples.
 * (Examples is last because it is the sparsest column.)
 *
 * Input JSON shape:
 *   [
 *     {
 *       "term": "string",
 *       "category": "string",          // optional
 *       "definition": "string",
 *       "examples": ["e1", "e2"],      // optional
 *       "points": ["p1", "p2", "p3"]   // 0-3
 *     },
 *     ...
 *   ]
 *
 * The "examples" and "points" arrays are joined into single cells with
 * bullet markers and newline separators so they render as multi-line
 * cells in Excel. Missing optional fields render as empty cells.
 *
 * Usage: node build-terms-xlsx.mjs <input.json> <output.xlsx>
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

async function main() {
  const [inputArg, outputArg] = process.argv.slice(2);
  if (!inputArg || !outputArg) {
    console.error('Usage: node build-terms-xlsx.mjs <input.json> <output.xlsx>');
    process.exit(1);
  }

  const inputPath = resolve(inputArg);
  const outputPath = resolve(outputArg);

  const raw = await readFile(inputPath, 'utf8');
  let terms;
  try {
    terms = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(terms)) {
    console.error('Input JSON must be an array of term objects.');
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'book-capture term-extractor';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Terms', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Term', key: 'term', width: 28 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Definition', key: 'definition', width: 60 },
    { header: 'Notes', key: 'notes', width: 60 },
    { header: 'Examples', key: 'examples', width: 36 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };

  const formatBulletList = (arr, cap) =>
    (Array.isArray(arr) ? arr : [])
      .slice(0, cap)
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .map((v) => `• ${v}`)
      .join('\n');

  let rowsAdded = 0;
  for (const entry of terms) {
    if (!entry || typeof entry !== 'object') continue;
    const term = String(entry.term ?? '').trim();
    if (!term) continue;
    const category = String(entry.category ?? '').trim();
    const definition = String(entry.definition ?? '').trim();
    const examples = formatBulletList(entry.examples, 5);
    const notes = formatBulletList(entry.points, 3);

    const row = sheet.addRow({ term, category, definition, notes, examples });
    row.alignment = { vertical: 'top', wrapText: true };
    rowsAdded += 1;
  }

  sheet.autoFilter = { from: 'A1', to: 'E1' };

  await workbook.xlsx.writeFile(outputPath);

  console.log(`Wrote ${rowsAdded} term${rowsAdded === 1 ? '' : 's'} to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
