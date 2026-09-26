// PDF text extraction, built on `unpdf` (works in Node route handlers without
// a browser canvas / DOM worker, unlike raw pdfjs-dist).
import { extractText, getDocumentProxy } from "unpdf";

/** Thrown when a PDF has no (or effectively no) extractable text, e.g. a scanned image. */
export class PdfNoTextError extends Error {
  constructor(message = "This PDF has no extractable text (it may be a scanned image).") {
    super(message);
    this.name = "PdfNoTextError";
  }
}

/** Minimum number of non-whitespace characters we require before trusting the extraction. */
const MIN_NON_WHITESPACE_CHARS = 50;

/**
 * Extracts raw text from a PDF's bytes. Pages are merged with a blank line
 * ("\n\n") between them. Throws `PdfNoTextError` if the result is too short
 * to be a real lease (e.g. a scanned/imaged PDF with no text layer).
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const merged = text.join("\n\n");

  const nonWhitespaceCount = merged.replace(/\s+/g, "").length;
  if (nonWhitespaceCount < MIN_NON_WHITESPACE_CHARS) {
    throw new PdfNoTextError();
  }

  return merged;
}
