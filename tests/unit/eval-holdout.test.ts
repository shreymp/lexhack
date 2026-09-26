// Fixture-integrity checks for the held-out lease. These check the eval fixture itself
// (not the pipeline's output) -- a weak mock-provider score on the holdout lease is
// expected and is the point (see eval/README.md's "Held-out lease" section), so this
// file never grades scoreResult() output; it only guards against a broken fixture.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Labels } from "../../eval/score";
import type { Rule } from "../../lib/types";

const EVAL_DIR = join(__dirname, "..", "..", "eval");
const RULES_PATH = join(__dirname, "..", "..", "rules", "chicago-rlto.json");

const leaseText = readFileSync(join(EVAL_DIR, "holdout-lease.txt"), "utf8");
const labels: Labels = JSON.parse(readFileSync(join(EVAL_DIR, "holdout-labels.json"), "utf8"));
const rulePack: { rules: Rule[] } = JSON.parse(readFileSync(RULES_PATH, "utf8"));
const ruleIds = new Set(rulePack.rules.map((r) => r.id));

describe("holdout lease fixture", () => {
  it("declares the expected lease and rent", () => {
    expect(labels.lease).toBe("holdout-lease.txt");
    expect(labels.monthly_rent).toBe(2100);
  });

  it("every label's match string is a unique substring of the holdout lease", () => {
    for (const clause of labels.clauses) {
      const first = leaseText.indexOf(clause.match);
      expect(first, `match not found in lease: ${JSON.stringify(clause.match)}`).toBeGreaterThanOrEqual(0);
      const count = leaseText.split(clause.match).length - 1;
      expect(count, `match is not unique (${count} occurrences): ${JSON.stringify(clause.match)}`).toBe(1);
    }
  });

  it("has no duplicate match strings across labels", () => {
    const seen = new Set<string>();
    for (const clause of labels.clauses) {
      expect(seen.has(clause.match), `duplicate match string: ${JSON.stringify(clause.match)}`).toBe(false);
      seen.add(clause.match);
    }
  });

  it("every expected red (likely_unenforceable) clause cites a rule_id that exists in the rule pack", () => {
    const redClauses = labels.clauses.filter((c) => c.expected === "likely_unenforceable");
    expect(redClauses.length).toBeGreaterThan(0);
    for (const clause of redClauses) {
      expect(clause.rule_id, `red clause has no rule_id: ${JSON.stringify(clause.match)}`).not.toBeNull();
      expect(ruleIds.has(clause.rule_id as string), `unknown rule_id ${clause.rule_id} for match ${JSON.stringify(clause.match)}`).toBe(true);
    }
  });

  it("plants six red clauses, each mapped to a different rule_id, including the late-fee rule", () => {
    const redClauses = labels.clauses.filter((c) => c.expected === "likely_unenforceable");
    expect(redClauses).toHaveLength(6);
    const redRuleIds = redClauses.map((c) => c.rule_id);
    expect(new Set(redRuleIds).size).toBe(redRuleIds.length);
    expect(redRuleIds).toContain("chi-rlto-140h-late-fee");
  });

  it("plants three yellow (one_sided) clauses with no rule_id", () => {
    const yellowClauses = labels.clauses.filter((c) => c.expected === "one_sided");
    expect(yellowClauses).toHaveLength(3);
    for (const clause of yellowClauses) {
      expect(clause.rule_id).toBeNull();
    }
  });

  it("non-red clauses never cite a rule_id", () => {
    for (const clause of labels.clauses) {
      if (clause.expected !== "likely_unenforceable") {
        expect(clause.rule_id, `non-red clause cites a rule_id: ${JSON.stringify(clause.match)}`).toBeNull();
      }
    }
  });

  it("has a label entry for every section of the lease (30 numbered sections)", () => {
    const sectionHeadings = leaseText.match(/^Section \d+ — /gm) ?? [];
    expect(sectionHeadings.length).toBe(30);
    expect(labels.clauses.length).toBe(30);
  });

  it("both missing-protection checks expect status \"found\" (the holdout lease includes both protections)", () => {
    expect(labels.missing).toEqual(
      expect.arrayContaining([
        { rule_id: "chi-rlto-170-summary", expected_status: "found" },
        { rule_id: "chi-rlto-080a3-deposit-bank", expected_status: "found" },
      ]),
    );
    for (const m of labels.missing) {
      expect(m.expected_status).toBe("found");
    }
  });

  it("references the RLTO summary and names a bank + address for the deposit", () => {
    expect(leaseText).toContain("City of Chicago Residential Landlord and Tenant Ordinance Summary is attached");
    expect(leaseText).toMatch(/Prairie Trust & Savings Bank, 900 West Adams Street/);
  });

  it("states the monthly rent exactly once", () => {
    const rentMentions = leaseText.split("$2,100.00").length - 1;
    expect(rentMentions).toBe(1);
  });

  it("never uses the word \"illegal\"", () => {
    expect(leaseText.toLowerCase()).not.toContain("illegal");
  });
});
