// Text normalization shared by every module. All offsets everywhere (Clause spans,
// quote_start/quote_end, etc.) refer to the output of normalizeSourceText.

/**
 * Normalizes raw source text (from a pasted textarea or a PDF extraction) into a
 * canonical form that the rest of the pipeline can rely on:
 *  - CRLF/CR -> LF
 *  - NBSP and other unicode space separators -> plain space
 *  - trailing whitespace stripped from each line
 *  - runs of 3+ blank lines collapsed to exactly 2 (one blank line)
 *  - leading/trailing whitespace trimmed from the whole document
 */
export function normalizeSourceText(raw: string): string {
  let text = raw.replace(/\r\n?/g, "\n");

  // Replace NBSP (U+00A0), other Unicode space separators (\p{Zs}), and a
  // handful of common non-breaking/zero-width-ish whitespace chars with a
  // regular space. We intentionally leave \n and \t alone here.
  text = text.replace(/[   -   　]/gu, " ");
  // Zero-width characters that sometimes leak in from PDF extraction.
  text = text.replace(/[​‌‍﻿]/g, "");

  // Strip trailing spaces/tabs on each line.
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");

  // Collapse 3+ consecutive newlines (i.e. 2+ blank lines) down to 2 newlines
  // (a single blank line).
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/**
 * Collapses all whitespace runs to a single space, for whitespace-tolerant
 * comparisons. Does NOT trim (callers usually want to trim separately).
 */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ");
}

/**
 * Normalizes "look-alike" punctuation that models frequently substitute when
 * quoting: curly quotes/apostrophes -> straight, en/em dash -> hyphen.
 * Used together with collapseWhitespace for tolerant matching.
 */
export function normalizePunctuation(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-");
}

/** Applies both whitespace collapsing and punctuation normalization. */
export function normalizeForMatch(s: string): string {
  return collapseWhitespace(normalizePunctuation(s)).trim();
}
