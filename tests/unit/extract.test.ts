import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfText, PdfNoTextError } from "@/lib/extract";

async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 50, y: 700, size: 14, font });
  }
  return doc.save();
}

describe("extractPdfText", () => {
  it("extracts text from a simple single-page PDF", async () => {
    const bytes = await makePdf(["This is a residential lease agreement for testing purposes."]);
    const text = await extractPdfText(bytes);
    expect(text).toContain("This is a residential lease agreement for testing purposes.");
  });

  it("merges multiple pages with a blank line", async () => {
    const bytes = await makePdf([
      "Page one has some lease text that is long enough to count as real content.",
      "Page two continues the lease with more text that is also long enough.",
    ]);
    const text = await extractPdfText(bytes);
    expect(text).toContain("Page one has some lease text");
    expect(text).toContain("Page two continues the lease");
    // Pages merged with a blank line between them.
    expect(text.includes("\n\n")).toBe(true);
  });

  it("throws PdfNoTextError for a PDF with no extractable text", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]); // blank page, no text at all
    const bytes = await doc.save();
    await expect(extractPdfText(bytes)).rejects.toBeInstanceOf(PdfNoTextError);
  });

  it("throws PdfNoTextError when the text is far too short to be a real lease", async () => {
    const bytes = await makePdf(["Hi"]);
    await expect(extractPdfText(bytes)).rejects.toBeInstanceOf(PdfNoTextError);
  });
});
