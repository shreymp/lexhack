// Pure helper: turns (sourceText, clauses, findings) into renderable segments.
// No React here so it's easy to unit test. Assumes offsets are usually valid,
// but defensively skips anything overlapping or out of range rather than throwing,
// since this renders untrusted-ish pipeline output.
import type { Clause, ClauseFinding, RiskLabel } from "@/lib/types";

export interface TextSegment {
  kind: "text";
  text: string;
}

export interface ClausePart {
  text: string;
  marked: boolean; // true = inside the verified quote, render with <mark>
}

export interface ClauseSegment {
  kind: "clause";
  clauseId: string;
  /** null when the clause has no finding (rendered as neutral / unanalyzed). */
  label: RiskLabel | null;
  parts: ClausePart[];
}

export type Segment = TextSegment | ClauseSegment;

export function buildSegments(
  sourceText: string,
  clauses: Clause[],
  findings: ClauseFinding[],
): Segment[] {
  const findingByClauseId = new Map(findings.map((f) => [f.clause_id, f]));
  const segments: Segment[] = [];
  const len = sourceText.length;

  const sorted = [...clauses].sort((a, b) => a.start - b.start);
  let cursor = 0;

  for (const clause of sorted) {
    // Guard against bad offsets: out of range, empty/inverted, or overlapping
    // a clause we already emitted.
    if (
      clause.start < cursor ||
      clause.end <= clause.start ||
      clause.start < 0 ||
      clause.end > len
    ) {
      continue;
    }

    if (clause.start > cursor) {
      segments.push({ kind: "text", text: sourceText.slice(cursor, clause.start) });
    }

    const finding = findingByClauseId.get(clause.id);
    const parts = buildClauseParts(sourceText, clause, finding);

    segments.push({
      kind: "clause",
      clauseId: clause.id,
      label: finding ? finding.label : null,
      parts,
    });

    cursor = clause.end;
  }

  if (cursor < len) {
    segments.push({ kind: "text", text: sourceText.slice(cursor, len) });
  }

  return segments;
}

function buildClauseParts(
  sourceText: string,
  clause: Clause,
  finding: ClauseFinding | undefined,
): ClausePart[] {
  const fallback: ClausePart[] = [{ text: clause.text, marked: false }];
  if (!finding) return fallback;

  const { quote_start, quote_end } = finding;
  const quoteValid =
    quote_start >= clause.start &&
    quote_end <= clause.end &&
    quote_start < quote_end;

  if (!quoteValid) return fallback;

  const parts: ClausePart[] = [];
  if (quote_start > clause.start) {
    parts.push({ text: sourceText.slice(clause.start, quote_start), marked: false });
  }
  parts.push({ text: sourceText.slice(quote_start, quote_end), marked: true });
  if (quote_end < clause.end) {
    parts.push({ text: sourceText.slice(quote_end, clause.end), marked: false });
  }
  return parts;
}
