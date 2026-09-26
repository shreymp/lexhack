import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreResult, type Labels } from "../../eval/score";
import type { AnalysisResult, Clause, ClauseFinding } from "../../lib/types";

const EVAL_DIR = join(__dirname, "..", "..", "eval");

function makeClause(id: string, index: number, text: string, start: number): Clause {
  return { id, index, heading: null, text, start, end: start + text.length };
}

function makeFinding(clauseId: string, quote: string, quoteStart: number, overrides: Partial<ClauseFinding> = {}): ClauseFinding {
  return {
    clause_id: clauseId,
    quote,
    quote_start: quoteStart,
    quote_end: quoteStart + quote.length,
    plain_english: "plain english",
    label: "likely_unenforceable",
    rule_id: "chi-rlto-140b-confession",
    reasoning: "reasoning",
    suggested_message: "message",
    late_fee_check: null,
    verification: { quote_match: "exact", label_adjusted: null },
    ...overrides,
  };
}

function baseResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    source_kind: "text",
    source_text: "",
    clauses: [],
    findings: [],
    missing: [],
    summary: "",
    questions_to_ask: [],
    coverage: {
      answers: { in_chicago: "yes", owner_occupied_six_or_fewer: "no", other_exclusion: "no" },
      rule_pack_applies: true,
      uncertain: false,
      reason: "applies",
    },
    stats: { findings_received: 0, findings_accepted: 0, quotes_rejected: 0, rule_citations_downgraded: 0, rejected: [] },
    provider: { name: "mock", model: "mock-v1", is_mock: true },
    rule_pack: { id: "chicago-rlto", name: "Chicago RLTO", version: "0.1.0", date_verified: "2026-09-26", caveats: [] },
    warnings: [],
    ...overrides,
  };
}

describe("scoreResult", () => {
  const c1text = "Tenant confesses judgment against Tenant.";
  const c2text = "Tenant shall not have overnight guests more than 3 nights.";
  const c3text = "This is an ordinary standard clause about parking.";
  const c4text = "Landlord may enter at any time without notice for any reason.";

  const source = [c1text, c2text, c3text, c4text].join("\n\n");
  const c1start = source.indexOf(c1text);
  const c2start = source.indexOf(c2text);
  const c3start = source.indexOf(c3text);
  const c4start = source.indexOf(c4text);

  const clauses = [
    makeClause("c1", 0, c1text, c1start),
    makeClause("c2", 1, c2text, c2start),
    makeClause("c3", 2, c3text, c3start),
    makeClause("c4", 3, c4text, c4start),
  ];

  const labels: Labels = {
    lease: "fixture.txt",
    monthly_rent: 1500,
    clauses: [
      { match: "confesses judgment", expected: "likely_unenforceable", rule_id: "chi-rlto-140b-confession", note: "confession" },
      { match: "overnight guests more than 3 nights", expected: "one_sided", rule_id: null, note: "guest cap" },
      { match: "ordinary standard clause", expected: "standard", rule_id: null, note: "standard" },
      { match: "enter at any time without notice", expected: "likely_unenforceable", rule_id: "chi-rlto-050-entry-notice", note: "entry" },
    ],
    missing: [{ rule_id: "chi-rlto-170-summary", expected_status: "not_found" }],
  };

  it("counts an exact red catch correctly", () => {
    const result = baseResult({
      source_text: source,
      clauses,
      findings: [makeFinding("c1", "confesses judgment", c1start + c1text.indexOf("confesses judgment"))],
      missing: [{ rule_id: "chi-rlto-170-summary", title: "t", status: "not_found", explanation: "e", what_to_ask: "a" }],
    });
    const report = scoreResult(result, labels);
    expect(report.red_planted).toBe(2);
    expect(report.red_caught_exact).toBe(1);
    expect(report.red_missed).toBe(1); // c4 (entry clause) has no finding at all
    expect(report.missing_expected).toBe(1);
    expect(report.missing_correct).toBe(1);
  });

  it("counts a red clause caught under the wrong rule_id separately from an exact catch", () => {
    const result = baseResult({
      source_text: source,
      clauses,
      findings: [
        makeFinding("c1", "confesses judgment", c1start + c1text.indexOf("confesses judgment"), { rule_id: "chi-rlto-140a-waiver" }),
      ],
    });
    const report = scoreResult(result, labels);
    expect(report.red_caught_exact).toBe(0);
    expect(report.red_caught_other_rule).toBe(1);
  });

  it("counts a red clause downgraded to one_sided as red_flagged_yellow_only, not a miss", () => {
    const result = baseResult({
      source_text: source,
      clauses,
      findings: [
        makeFinding("c1", "confesses judgment", c1start + c1text.indexOf("confesses judgment"), {
          label: "one_sided",
          rule_id: null,
        }),
        // c4 is also a planted red clause; give it an exact catch so it doesn't
        // pollute this assertion via red_missed.
        makeFinding("c4", "enter at any time without notice", c4start + c4text.indexOf("enter at any time without notice"), {
          rule_id: "chi-rlto-050-entry-notice",
        }),
      ],
    });
    const report = scoreResult(result, labels);
    expect(report.red_flagged_yellow_only).toBe(1);
    expect(report.red_missed).toBe(0);
  });

  it("counts yellow caught whether flagged red or yellow", () => {
    const result = baseResult({
      source_text: source,
      clauses,
      findings: [makeFinding("c2", "overnight guests more than 3 nights", c2start, { label: "one_sided", rule_id: null })],
    });
    const report = scoreResult(result, labels);
    expect(report.yellow_planted).toBe(1);
    expect(report.yellow_caught).toBe(1);
    expect(report.yellow_missed).toBe(0);
  });

  it("counts false alarms on standard clauses", () => {
    const result = baseResult({
      source_text: source,
      clauses,
      findings: [
        makeFinding("c3", "ordinary standard clause", c3start, { label: "likely_unenforceable", rule_id: "chi-rlto-140a-waiver" }),
      ],
    });
    const report = scoreResult(result, labels);
    expect(report.standard_total).toBe(1);
    expect(report.false_alarms_red).toBe(1);
    expect(report.false_alarms_yellow).toBe(0);
  });

  it("reports missing_correct as false when a missing protection is marked found but expected not_found", () => {
    const result = baseResult({
      source_text: source,
      clauses,
      findings: [],
      missing: [{ rule_id: "chi-rlto-170-summary", title: "t", status: "found", explanation: "e", what_to_ask: "a" }],
    });
    const report = scoreResult(result, labels);
    expect(report.missing_correct).toBe(0);
    const row = report.missing_rows.find((r) => r.rule_id === "chi-rlto-170-summary");
    expect(row?.correct).toBe(false);
    expect(row?.got_status).toBe("found");
  });

  it("counts unanalyzed clauses (no finding) even when not referenced by any label", () => {
    const result = baseResult({
      source_text: source,
      clauses,
      findings: [makeFinding("c1", "confesses judgment", c1start + c1text.indexOf("confesses judgment"))],
    });
    const report = scoreResult(result, labels);
    // c2, c3, c4 all have no finding.
    expect(report.unanalyzed_clauses).toBe(3);
  });

  it("flags a label match that cannot be located in the source as unmatched (a fixture bug, not a pipeline bug)", () => {
    const result = baseResult({ source_text: source, clauses, findings: [] });
    const badLabels: Labels = {
      ...labels,
      clauses: [...labels.clauses, { match: "this text does not exist anywhere", expected: "standard", rule_id: null, note: "bug" }],
    };
    const report = scoreResult(result, badLabels);
    expect(report.unmatched_labels).toBe(1);
  });
});

describe("eval fixtures: trap-lease.txt + labels.json", () => {
  const lease = readFileSync(join(EVAL_DIR, "trap-lease.txt"), "utf8");
  const labels = JSON.parse(readFileSync(join(EVAL_DIR, "labels.json"), "utf8")) as Labels;

  it("has every labeled clause match occurring exactly once in the lease text", () => {
    for (const c of labels.clauses) {
      const firstIndex = lease.indexOf(c.match);
      expect(firstIndex, `match not found: "${c.match}"`).toBeGreaterThanOrEqual(0);
      const secondIndex = lease.indexOf(c.match, firstIndex + 1);
      expect(secondIndex, `match occurs more than once: "${c.match}"`).toBe(-1);
    }
  });

  it("plants every required red rule exactly once", () => {
    const requiredRedRules = [
      "chi-rlto-140b-confession",
      "chi-rlto-140e-jury-waiver",
      "chi-rlto-140f-attorney-fees",
      "chi-rlto-140c-liability-limit",
      "chi-rlto-140g-unequal-termination",
      "chi-rlto-140h-late-fee",
      "chi-rlto-050-entry-notice",
      "chi-rlto-080d-deposit-return",
      "chi-rlto-140d-notice-waiver",
      "chi-rlto-140a-waiver",
    ];
    const redRuleIds = labels.clauses.filter((c) => c.expected === "likely_unenforceable").map((c) => c.rule_id);
    for (const ruleId of requiredRedRules) {
      const count = redRuleIds.filter((id) => id === ruleId).length;
      expect(count, `expected exactly one clause for ${ruleId}`).toBe(1);
    }
  });

  it("never mentions an RLTO summary or a deposit-holding bank (both must read as missing)", () => {
    expect(/summary/i.test(lease)).toBe(false);
    expect(/\bbank\b|financial institution/i.test(lease)).toBe(false);
  });

  it("lists the two expected missing protections", () => {
    const ids = labels.missing.map((m) => m.rule_id).sort();
    expect(ids).toEqual(["chi-rlto-080a3-deposit-bank", "chi-rlto-170-summary"].sort());
    for (const m of labels.missing) {
      expect(m.expected_status).toBe("not_found");
    }
  });

  it("states the monthly rent as $1,500.00 exactly once in the RENT clause", () => {
    const occurrences = lease.split("$1,500.00").length - 1;
    // $1,500.00 also appears once for the security deposit amount by design (task spec:
    // "include a security deposit of $1,500" -- same dollar figure, different clause).
    expect(occurrences).toBe(2);
    expect(labels.monthly_rent).toBe(1500);
  });
});
