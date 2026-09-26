#!/usr/bin/env -S npx tsx
// Renders eval/trap-lease.txt into eval/trap-lease.pdf: Letter size, 11pt Helvetica,
// word-wrapped, multi-page, 1-inch margins. Used to test the PDF-extraction path
// (lib/extract.ts) end to end, not just the plain-text path.
//
// Run with: npm run make:trap-pdf

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, PageSizes, PDFFont } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FONT_SIZE = 11;
const LINE_HEIGHT = FONT_SIZE * 1.35;
const MARGIN = 72; // 1 inch
const [PAGE_WIDTH, PAGE_HEIGHT] = PageSizes.Letter;
const MAX_WIDTH = PAGE_WIDTH - MARGIN * 2;

/**
 * Helvetica (a WinAnsi standard font) can only encode WinAnsi codepoints.
 * Replace common punctuation/typography outside that range with plain ASCII
 * equivalents so pdf-lib's drawText doesn't throw on encoding.
 */
function toWinAnsiSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, "-")
    .replace(/—/g, "--")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    // Strip anything else outside the printable Latin-1 range pdf-lib/WinAnsi supports.
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
}

/** Wraps a single logical line (no embedded newlines) into lines that fit maxWidth. */
function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (text.length === 0) return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current.length > 0) lines.push(current);
      // A single word wider than maxWidth: just place it on its own line (rare here).
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

async function main() {
  const srcPath = join(__dirname, "trap-lease.txt");
  const rawText = readFileSync(srcPath, "utf8");
  const safeText = toWinAnsiSafe(rawText);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  pdfDoc.setTitle("Trap Lease (synthetic, eval fixture)");
  pdfDoc.setAuthor("Before You Sign -- eval fixture generator");

  // Split the source into paragraphs on blank lines, then wrap each paragraph.
  const paragraphs = safeText.split(/\n\s*\n/);
  const allLines: string[] = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const paragraphLines = paragraphs[p].split("\n");
    for (const line of paragraphLines) {
      const wrapped = wrapLine(line.trimEnd(), font, FONT_SIZE, MAX_WIDTH);
      allLines.push(...wrapped);
    }
    if (p < paragraphs.length - 1) allLines.push(""); // blank line between paragraphs
  }

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  for (const line of allLines) {
    if (y < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
    if (line.length > 0) {
      page.drawText(line, { x: MARGIN, y, size: FONT_SIZE, font });
    }
    y -= LINE_HEIGHT;
  }

  const bytes = await pdfDoc.save();
  const outPath = join(__dirname, "trap-lease.pdf");
  writeFileSync(outPath, bytes);
  console.log(`Wrote ${outPath} (${pdfDoc.getPageCount()} pages, ${bytes.length} bytes)`);
}

main().catch((err) => {
  console.error("make-pdf failed:", err);
  process.exit(1);
});
