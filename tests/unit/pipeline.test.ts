import { describe, expect, it } from "vitest";
import { runAnalysis } from "@/lib/pipeline";
import { MockProvider } from "@/lib/llm/mock";
import type { CoverageAnswers } from "@/lib/types";

const LEASE_TEXT = `1. RENT. Tenant agrees to pay Landlord monthly rent of $1,500.00 per month, due on the 1st of each month.

2. LATE CHARGES. If rent is not paid by the 5th of the month, Tenant shall pay a late fee of $100.00.

3. CONFESSION OF JUDGMENT. Tenant hereby authorizes any attorney to confess judgment against Tenant for any amount due under this Agreement.

4. QUIET ENJOYMENT. Landlord shall provide Tenant with quiet enjoyment of the premises throughout the tenancy, without interference from Landlord.`;

const COVERAGE_APPLIES: CoverageAnswers = {
  in_chicago: "yes",
  owner_occupied_six_or_fewer: "no",
  other_exclusion: "no",
};

describe("runAnalysis (mock provider, end-to-end)", () => {
  it("flags the confession-of-judgment clause and the over-cap late fee, using the mock provider", async () => {
    const result = await runAnalysis({
      sourceText: LEASE_TEXT,
      sourceKind: "text",
      coverage: COVERAGE_APPLIES,
      monthlyRent: 1500,
      provider: new MockProvider(),
    });

    expect(result.provider.is_mock).toBe(true);

    const confession = result.findings.find((f) => f.rule_id === "chi-rlto-140b-confession");
    expect(confession).toBeDefined();
    expect(confession?.label).toBe("likely_unenforceable");

    const lateFee = result.findings.find((f) => f.rule_id === "chi-rlto-140h-late-fee");
    expect(lateFee).toBeDefined();
    expect(lateFee?.label).toBe("likely_unenforceable");
    expect(lateFee?.late_fee_check).not.toBeNull();
    expect(lateFee?.late_fee_check?.cap).toBe(60);
    expect(lateFee?.late_fee_check?.over_cap).toBe(true);

    // Every accepted finding's quote must be the exact slice of source_text
    // at its own offsets (the verify.ts invariant this whole pipeline relies on).
    for (const finding of result.findings) {
      expect(finding.quote).toBe(result.source_text.slice(finding.quote_start, finding.quote_end));
    }

    // A normal, uncontroversial clause should not be flagged as unenforceable.
    const quietEnjoyment = result.findings.find((f) => f.clause_id === "c4");
    expect(quietEnjoyment?.label).not.toBe("likely_unenforceable");

    expect(result.warnings).toContain("Demo mode: results come from simple keyword rules, not an AI model.");
    expect(result.rule_pack.id).toBe("chicago-rlto");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.questions_to_ask.length).toBeGreaterThanOrEqual(3);
    expect(result.questions_to_ask.length).toBeLessThanOrEqual(6);
  });

  it("never labels a clause likely_unenforceable when the rule pack doesn't apply", async () => {
    const result = await runAnalysis({
      sourceText: LEASE_TEXT,
      sourceKind: "text",
      coverage: { in_chicago: "no", owner_occupied_six_or_fewer: "no", other_exclusion: "no" },
      monthlyRent: 1500,
      provider: new MockProvider(),
    });

    expect(result.coverage.rule_pack_applies).toBe(false);
    for (const finding of result.findings) {
      expect(finding.label).not.toBe("likely_unenforceable");
      expect(finding.rule_id).toBeNull();
    }
  });
});
