// Splits a normalized lease document into clauses the analyzer can label
// independently. Operates purely on offsets into the given (already
// normalized, see lib/text.ts) text -- every Clause satisfies
// text === source.slice(start, end).
import type { Clause } from "@/lib/types";
import { collapseWhitespace } from "@/lib/text";

/** Clauses longer than this are split further on paragraph boundaries. */
const MAX_CLAUSE_CHARS = 2500;

interface HeadingMatch {
  /** Offset of the start of the line the heading was found on. */
  start: number;
  label: string;
}

interface RawSpan {
  start: number;
  end: number;
  heading: string | null;
}

/** A line and the offset (into the full text) where it starts. */
interface Line {
  text: string;
  start: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  for (const raw of text.split("\n")) {
    lines.push({ text: raw, start: offset });
    offset += raw.length + 1; // +1 for the '\n' we split on
  }
  return lines;
}

// Numbered/lettered heading patterns, checked in priority order. Each must
// anchor at the (optionally indented) start of a line and be followed by
// whitespace + content, so we don't match e.g. a phone number or a stray
// decimal in running prose.
const RE_DECIMAL = /^[ \t]*(\d{1,3}\.\d{1,3})\s+\S/; // "12.3 Subletting"
const RE_NUM_PAREN = /^[ \t]*(\d{1,3}\([a-zA-Z]\))\s+\S/; // "12(a) Subletting"
const RE_NUM_DOT = /^[ \t]*(\d{1,3})\.(?!\d)\s+\S/; // "12. Subletting" (not "12.3")
const RE_SECTION = /^[ \t]*(Section\s+\d+[A-Za-z]?)\b/i; // "Section 12"
const RE_ARTICLE = /^[ \t]*(ARTICLE\s+(?:[IVXLCDM]+|\d+))\b/i; // "ARTICLE IV"

// A standalone ALL-CAPS line used as a section title (e.g. "LATE CHARGES" on
// its own line, common in leases that don't number every section). Requires
// at least one letter and no lowercase letters, and a plausible title length.
const RE_ALL_CAPS = /^[A-Z0-9][A-Z0-9 ,'&\-/:.]*$/;

function detectNumberedHeading(line: string): string | null {
  let m = RE_DECIMAL.exec(line);
  if (m) return m[1];
  m = RE_NUM_PAREN.exec(line);
  if (m) return m[1];
  m = RE_NUM_DOT.exec(line);
  if (m) return `${m[1]}.`;
  m = RE_SECTION.exec(line);
  if (m) return collapseWhitespace(m[1]).trim();
  m = RE_ARTICLE.exec(line);
  if (m) return collapseWhitespace(m[1]).trim();
  return null;
}

function isAllCapsTitle(trimmed: string): boolean {
  if (trimmed.length < 3 || trimmed.length > 70) return false;
  if (!RE_ALL_CAPS.test(trimmed)) return false;
  if (!/[A-Z]/.test(trimmed)) return false;
  if (/[a-z]/.test(trimmed)) return false;
  return true;
}

/**
 * Finds heading lines in the (normalized) text.
 *
 * Note on nested sub-items: a bare "(a)" / "(b)" at the start of a line is
 * deliberately NOT treated as a heading here. Distinguishing "a lettered
 * sub-item that should join its parent clause" from "a lettered sub-item
 * that is really its own top-level provision" is a judgment call the spec
 * leaves to us; we consistently choose the former (sub-items stay inside
 * their parent clause's text) so that segmentation is predictable and each
 * clause the analyzer sees has real body text, not a one-line fragment.
 */
function findHeadings(text: string): HeadingMatch[] {
  const lines = splitLines(text);
  const headings: HeadingMatch[] = [];
  let prevWasNumbered = false;

  for (const line of lines) {
    const numberedLabel = detectNumberedHeading(line.text);
    if (numberedLabel) {
      headings.push({ start: line.start, label: numberedLabel });
      prevWasNumbered = true;
      continue;
    }

    const trimmed = line.text.trim();
    if (trimmed && isAllCapsTitle(trimmed)) {
      if (prevWasNumbered) {
        // This all-caps line is the title of the heading we just matched on
        // the previous line (e.g. "12.\nLATE CHARGES") -- fold it into the
        // same clause rather than starting a new one.
        prevWasNumbered = false;
        continue;
      }
      headings.push({ start: line.start, label: trimmed });
    }
    prevWasNumbered = false;
  }

  return headings;
}

/** Trims whitespace off a [start, end) span, returning null if it's all whitespace. */
function trimSpan(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (s >= e) return null;
  return { start: s, end: e };
}

/** Splits [start, end) on blank-line ("\n\n") paragraph boundaries. Spans are not trimmed. */
function findParagraphSpans(text: string, start: number, end: number): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const re = /\n{2,}/g;
  re.lastIndex = start;
  let segStart = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m.index < end) {
    spans.push({ start: segStart, end: m.index });
    segStart = m.index + m[0].length;
  }
  spans.push({ start: segStart, end });
  return spans;
}

/**
 * Splits an over-long clause into multiple pieces on paragraph boundaries,
 * greedily packing paragraphs up to MAX_CLAUSE_CHARS. If the clause has no
 * internal paragraph breaks, it's returned unsplit (nothing more we can do).
 * Only the first piece keeps the original heading label.
 */
function splitLongClause(text: string, span: RawSpan): RawSpan[] {
  if (span.end - span.start <= MAX_CLAUSE_CHARS) return [span];

  const paragraphs = findParagraphSpans(text, span.start, span.end)
    .map((p) => trimSpan(text, p.start, p.end))
    .filter((p): p is { start: number; end: number } => p !== null);

  if (paragraphs.length <= 1) return [span]; // nothing to split on

  const chunks: RawSpan[] = [];
  let chunkStart = paragraphs[0].start;
  let chunkEnd = paragraphs[0].end;

  for (let i = 1; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (p.end - chunkStart > MAX_CLAUSE_CHARS) {
      chunks.push({ start: chunkStart, end: chunkEnd, heading: chunks.length === 0 ? span.heading : null });
      chunkStart = p.start;
      chunkEnd = p.end;
    } else {
      chunkEnd = p.end;
    }
  }
  chunks.push({ start: chunkStart, end: chunkEnd, heading: chunks.length === 0 ? span.heading : null });

  return chunks;
}

export function segmentClauses(text: string): Clause[] {
  const headings = findHeadings(text);

  let rawSpans: RawSpan[] = [];

  if (headings.length === 0) {
    // No numbering/titles detected at all: fall back to blank-line paragraphs.
    rawSpans = findParagraphSpans(text, 0, text.length).map((p) => ({ ...p, heading: null }));
  } else {
    if (headings[0].start > 0) {
      rawSpans.push({ start: 0, end: headings[0].start, heading: null });
    }
    for (let i = 0; i < headings.length; i++) {
      const end = i + 1 < headings.length ? headings[i + 1].start : text.length;
      rawSpans.push({ start: headings[i].start, end, heading: headings[i].label });
    }
  }

  const clauses: Clause[] = [];
  let index = 0;

  for (const raw of rawSpans) {
    const trimmed = trimSpan(text, raw.start, raw.end);
    if (!trimmed) continue; // drop empty/whitespace-only spans

    const pieces = splitLongClause(text, { ...trimmed, heading: raw.heading });
    for (const piece of pieces) {
      const t = trimSpan(text, piece.start, piece.end);
      if (!t) continue;
      clauses.push({
        id: `c${index + 1}`,
        index,
        heading: piece.heading,
        text: text.slice(t.start, t.end),
        start: t.start,
        end: t.end,
      });
      index++;
    }
  }

  return clauses;
}
