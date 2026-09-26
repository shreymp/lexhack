import { describe, expect, it } from "vitest";
import { segmentClauses } from "@/lib/segment";
import { normalizeSourceText } from "@/lib/text";

function assertInvariants(source: string, clauses: ReturnType<typeof segmentClauses>) {
  expect(clauses.length).toBeGreaterThan(0);
  let prevEnd = -1;
  clauses.forEach((c, i) => {
    expect(c.id).toBe(`c${i + 1}`);
    expect(c.index).toBe(i);
    expect(c.text).toBe(source.slice(c.start, c.end));
    expect(c.start).toBeGreaterThanOrEqual(prevEnd);
    expect(c.end).toBeGreaterThan(c.start);
    expect(c.text.trim()).toBe(c.text); // trimmed
    expect(c.text.length).toBeGreaterThan(0);
    prevEnd = c.end;
  });
}

describe("segmentClauses", () => {
  it("splits a numbered lease into clauses and preserves the invariant", () => {
    const source = normalizeSourceText(`
LEASE AGREEMENT

This lease is made between Landlord and Tenant.

1. RENT

Tenant shall pay $1,500.00 per month, due on the first of each month.

2. LATE CHARGES

If rent is not paid within 5 days, tenant shall pay a late fee of $50.

3. SECURITY DEPOSIT

Tenant shall pay a security deposit of $1,500.00 held at First Chicago Bank.
`);
    const clauses = segmentClauses(source);
    assertInvariants(source, clauses);

    // "LEASE AGREEMENT" is itself an all-caps title line, so it's detected as
    // a heading (its own clause) rather than being folded into a preamble.
    expect(clauses[0].heading).toBe("LEASE AGREEMENT");
    expect(clauses[0].text).toContain("LEASE AGREEMENT");

    const headings = clauses.map((c) => c.heading).filter(Boolean);
    expect(headings).toContain("1.");
    expect(headings).toContain("2.");
    expect(headings).toContain("3.");

    const rentClause = clauses.find((c) => c.heading === "1.");
    expect(rentClause?.text).toContain("$1,500.00 per month");
  });

  it("detects Section / ARTICLE / decimal / letter-in-paren headings", () => {
    const source = normalizeSourceText(`
Section 1 Introduction text here that is long enough.

ARTICLE IV Termination text here that is also long enough to matter.

12.3 Subletting is not allowed under any circumstance without written consent.

12(a) Pets are not allowed anywhere on the premises at any time whatsoever.
`);
    const clauses = segmentClauses(source);
    assertInvariants(source, clauses);
    const headings = clauses.map((c) => c.heading);
    expect(headings).toContain("Section 1");
    expect(headings).toContain("ARTICLE IV");
    expect(headings).toContain("12.3");
    expect(headings).toContain("12(a)");
  });

  it("keeps bare lettered sub-items inside their parent clause", () => {
    const source = normalizeSourceText(`
1. RULES

The following rules apply:

(a) No smoking indoors.

(b) No pets over 20 lbs.
`);
    const clauses = segmentClauses(source);
    assertInvariants(source, clauses);
    // Only one clause should exist for section 1 (no split on bare "(a)"/"(b)").
    const numbered = clauses.filter((c) => c.heading === "1.");
    expect(numbered.length).toBe(1);
    expect(numbered[0].text).toContain("(a) No smoking indoors.");
    expect(numbered[0].text).toContain("(b) No pets over 20 lbs.");
  });

  it("falls back to blank-line paragraphs when there is no numbering", () => {
    const source = normalizeSourceText(`
This is the first paragraph of an unnumbered lease document with enough text.

This is the second paragraph, also unnumbered, discussing rent and deposits.

This is the third paragraph about termination and notice requirements here.
`);
    const clauses = segmentClauses(source);
    assertInvariants(source, clauses);
    expect(clauses.length).toBe(3);
    expect(clauses.every((c) => c.heading === null)).toBe(true);
  });

  it("splits a very long clause on paragraph boundaries", () => {
    const paragraph = "This sentence repeats to build a long paragraph of lease text. ".repeat(40); // ~2640 chars
    const source = normalizeSourceText(`1. LONG CLAUSE\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`);
    const clauses = segmentClauses(source);
    assertInvariants(source, clauses);
    expect(clauses.length).toBeGreaterThan(1);
    expect(clauses[0].heading).toBe("1.");
    // Only the first split piece keeps the heading label.
    expect(clauses.slice(1).every((c) => c.heading === null)).toBe(true);
    for (const c of clauses) {
      expect(c.text.length).toBeLessThanOrEqual(2500 + paragraph.length); // generous bound; single paragraph can't be split further
    }
  });

  it("drops empty/whitespace-only spans", () => {
    const source = normalizeSourceText(`1. FIRST\n\nSome real content here.\n\n2. SECOND\n\n\n`);
    const clauses = segmentClauses(source);
    assertInvariants(source, clauses);
    expect(clauses.some((c) => c.text.trim() === "")).toBe(false);
  });
});
