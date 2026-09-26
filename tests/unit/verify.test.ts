import { describe, expect, it } from "vitest";
import { verifyFindings, sanitizeText } from "@/lib/verify";
import type { Clause } from "@/lib/types";

const SOURCE =
  "1. RENT\n\n" +
  "Tenant shall pay a monthly rent of $1,500.00, due on the first of each month.\n\n" +
  "2. LATE CHARGES\n\n" +
  "If rent is not paid within 5 days, tenant shall pay a late fee of $100 per occurrence.\n\n" +
  "3. WAIVER\n\n" +
  "Tenant waives any and all rights and remedies under the Chicago Residential Landlord and Tenant Ordinance.\n\n" +
  "4. LIABILITY\n\n" +
  "Landlord shall not be liable for any injury or damage, even if caused by Landlord's own negligence.\n\n" +
  "5. STANDARD\n\n" +
  "Tenant shall keep the unit clean and free of garbage at all times.";

function makeClauses(): Clause[] {
  const headings = ["1. RENT", "2. LATE CHARGES", "3. WAIVER", "4. LIABILITY", "5. STANDARD"];
  const clauses: Clause[] = [];
  let cursor = 0;
  const parts = SOURCE.split(/\n\n(?=\d\. )/);
  // Rebuild with accurate offsets by scanning the source directly.
  let idx = 0;
  const labels = ["1.", "2.", "3.", "4.", "5."];
  const starts = labels.map((l) => SOURCE.indexOf(`${l} `));
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : SOURCE.length;
    const text = SOURCE.slice(start, end).replace(/\s+$/, "");
    clauses.push({ id: `c${i + 1}`, index: i, heading: labels[i], text, start, end: start + text.length });
  }
  void cursor;
  void parts;
  void idx;
  void headings;
  return clauses;
}

const CLAUSES = makeClauses();

const baseCtx = {
  clauses: CLAUSES,
  sourceText: SOURCE,
  rulePackApplies: true,
  rent: { amount: null as number | null, source: null as "user" | "lease_text" | null },
};

function findingFor(
  clauseId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const clause = CLAUSES.find((c) => c.id === clauseId)!;
  return {
    clause_id: clauseId,
    quote: clause.text,
    plain_english: "This clause does something.",
    label: "standard",
    rule_id: null,
    reasoning: "Because it says so.",
    suggested_message: null,
    late_fee: null,
    ...overrides,
  };
}

describe("verifyFindings", () => {
  it("rejects a fabricated quote that doesn't appear in the lease", () => {
    const raw = [findingFor("c1", { quote: "This text was never in the lease at all." })];
    const { findings, stats } = verifyFindings(raw, baseCtx);
    expect(findings.length).toBe(0);
    expect(stats.quotes_rejected).toBe(1);
    expect(stats.rejected[0].reason).toBe("quote_not_found");
  });

  it("accepts a quote with curly quotes / extra whitespace via whitespace-tolerant matching, with correct offsets", () => {
    // Real text: "Tenant shall pay a monthly rent of $1,500.00, due on the first of each month."
    const fuzzyQuote = "Tenant shall pay a monthly   rent of $1,500.00, due on the first of each month.";
    const raw = [findingFor("c1", { quote: fuzzyQuote })];
    const { findings } = verifyFindings(raw, baseCtx);
    expect(findings.length).toBe(1);
    const f = findings[0];
    expect(f.verification.quote_match).toBe("whitespace_normalized");
    expect(f.quote).toBe(SOURCE.slice(f.quote_start, f.quote_end));
    expect(f.quote).toContain("Tenant shall pay a monthly rent of $1,500.00");
  });

  it("rejects quotes shorter than 12 chars that aren't the whole clause", () => {
    const raw = [findingFor("c1", { quote: "monthly" })];
    const { findings, stats } = verifyFindings(raw, baseCtx);
    expect(findings.length).toBe(0);
    expect(stats.rejected[0].reason).toBe("quote_not_found");
  });

  it("downgrades a fake/unknown rule_id from likely_unenforceable to one_sided", () => {
    const raw = [
      findingFor("c3", {
        label: "likely_unenforceable",
        rule_id: "chi-rlto-not-a-real-rule",
        quote: "Tenant waives any and all rights and remedies under the Chicago Residential Landlord and Tenant Ordinance.",
      }),
    ];
    const { findings, stats } = verifyFindings(raw, baseCtx);
    expect(findings.length).toBe(1);
    expect(findings[0].label).toBe("one_sided");
    expect(findings[0].rule_id).toBeNull();
    expect(findings[0].verification.label_adjusted?.from).toBe("likely_unenforceable");
    expect(stats.rule_citations_downgraded).toBe(1);
  });

  it("downgrades likely_unenforceable to one_sided when the rule pack does not apply", () => {
    const raw = [
      findingFor("c3", {
        label: "likely_unenforceable",
        rule_id: "chi-rlto-140a-waiver",
        quote: "Tenant waives any and all rights and remedies under the Chicago Residential Landlord and Tenant Ordinance.",
      }),
    ];
    const { findings } = verifyFindings(raw, { ...baseCtx, rulePackApplies: false });
    expect(findings[0].label).toBe("one_sided");
    expect(findings[0].rule_id).toBeNull();
    expect(findings[0].verification.label_adjusted?.reason).toMatch(/may not cover this rental/);
  });

  it("keeps a valid likely_unenforceable citation when the rule pack applies", () => {
    const raw = [
      findingFor("c4", {
        label: "likely_unenforceable",
        rule_id: "chi-rlto-140c-liability-limit",
        quote: "Landlord shall not be liable for any injury or damage, even if caused by Landlord's own negligence.",
      }),
    ];
    const { findings, stats } = verifyFindings(raw, baseCtx);
    expect(findings[0].label).toBe("likely_unenforceable");
    expect(findings[0].rule_id).toBe("chi-rlto-140c-liability-limit");
    expect(findings[0].verification.label_adjusted).toBeNull();
    expect(stats.rule_citations_downgraded).toBe(0);
  });

  it("flags a $100 late fee on $1,500 rent as likely_unenforceable citing the late-fee rule", () => {
    const raw = [
      findingFor("c2", {
        label: "one_sided",
        rule_id: null,
        quote: "If rent is not paid within 5 days, tenant shall pay a late fee of $100 per occurrence.",
        late_fee: {
          basis: "flat_per_occurrence",
          amount: 100,
          initial_flat_amount: null,
          max_days: null,
          monthly_rent_in_clause: null,
        },
      }),
    ];
    const { findings } = verifyFindings(raw, { ...baseCtx, rent: { amount: 1500, source: "user" } });
    expect(findings[0].label).toBe("likely_unenforceable");
    expect(findings[0].rule_id).toBe("chi-rlto-140h-late-fee");
    expect(findings[0].late_fee_check?.over_cap).toBe(true);
    expect(findings[0].verification.label_adjusted?.from).toBe("one_sided");
  });

  it("downgrades a $50 late fee cited as the late-fee rule to standard (within cap)", () => {
    const raw = [
      findingFor("c2", {
        label: "likely_unenforceable",
        rule_id: "chi-rlto-140h-late-fee",
        quote: "If rent is not paid within 5 days, tenant shall pay a late fee of $100 per occurrence.",
        late_fee: {
          basis: "flat_per_occurrence",
          amount: 50,
          initial_flat_amount: null,
          max_days: null,
          monthly_rent_in_clause: null,
        },
      }),
    ];
    const { findings, stats } = verifyFindings(raw, { ...baseCtx, rent: { amount: 1500, source: "user" } });
    expect(findings[0].label).toBe("standard");
    expect(findings[0].rule_id).toBeNull();
    expect(findings[0].suggested_message).toBeNull();
    expect(findings[0].verification.label_adjusted?.reason).toMatch(/Within the Chicago cap/);
    expect(stats.rule_citations_downgraded).toBe(1);
  });

  it("downgrades to one_sided when the rent amount can't be confirmed", () => {
    const raw = [
      findingFor("c2", {
        label: "likely_unenforceable",
        rule_id: "chi-rlto-140h-late-fee",
        quote: "If rent is not paid within 5 days, tenant shall pay a late fee of $100 per occurrence.",
        late_fee: {
          basis: "flat_per_occurrence",
          amount: 100,
          initial_flat_amount: null,
          max_days: null,
          monthly_rent_in_clause: null,
        },
      }),
    ];
    const { findings } = verifyFindings(raw, { ...baseCtx, rent: { amount: null, source: null } });
    expect(findings[0].label).toBe("one_sided");
    expect(findings[0].rule_id).toBeNull();
    expect(findings[0].verification.label_adjusted?.reason).toMatch(/Couldn't confirm the rent amount/);
  });

  it("rejects an unknown clause_id", () => {
    const raw = [findingFor("c99")];
    const { findings, stats } = verifyFindings(raw, baseCtx);
    expect(findings.length).toBe(0);
    expect(stats.rejected[0].reason).toBe("unknown_clause_id");
  });

  it("rejects schema-invalid raw findings", () => {
    const raw = [{ clause_id: "c1", quote: "x" /* missing required fields */ }];
    const { findings, stats } = verifyFindings(raw, baseCtx);
    expect(findings.length).toBe(0);
    expect(stats.rejected[0].reason).toBe("schema_invalid");
  });

  it("treats a second finding for the same clause as a duplicate, keeping the first", () => {
    const raw = [
      findingFor("c5", { plain_english: "First finding." }),
      findingFor("c5", { plain_english: "Second finding." }),
    ];
    const { findings, stats } = verifyFindings(raw, baseCtx);
    expect(findings.length).toBe(1);
    expect(findings[0].plain_english).toBe("First finding.");
    expect(stats.rejected.some((r) => r.reason === "duplicate")).toBe(true);
  });

  it("sorts findings by clause index", () => {
    const raw = [findingFor("c5"), findingFor("c1"), findingFor("c3")];
    const { findings } = verifyFindings(raw, baseCtx);
    expect(findings.map((f) => f.clause_id)).toEqual(["c1", "c3", "c5"]);
  });

  it("computes overall stats correctly", () => {
    const raw = [findingFor("c1"), findingFor("c99"), findingFor("c2", { quote: "nope, not in the lease text" })];
    const { stats } = verifyFindings(raw, baseCtx);
    expect(stats.findings_received).toBe(3);
    expect(stats.findings_accepted).toBe(1);
    expect(stats.rejected.length).toBe(2);
  });
});

describe("sanitizeText", () => {
  it("replaces 'illegally' with 'improperly'", () => {
    expect(sanitizeText("The landlord acted illegally here.")).toBe("The landlord acted improperly here.");
  });

  it("replaces 'illegal' with 'likely unenforceable'", () => {
    expect(sanitizeText("This clause is illegal.")).toBe("This clause is likely unenforceable.");
  });

  it("is case-insensitive and does not double-replace 'illegally'", () => {
    expect(sanitizeText("ILLEGAL and Illegally")).toBe("likely unenforceable and improperly");
  });

  it("leaves unrelated text untouched", () => {
    expect(sanitizeText("This is a perfectly normal sentence.")).toBe("This is a perfectly normal sentence.");
  });
});
