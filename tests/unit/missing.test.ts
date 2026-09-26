import { describe, expect, it } from "vitest";
import { checkMissingProtections } from "@/lib/missing";

describe("checkMissingProtections", () => {
  it("returns an empty array when the rule pack does not apply", () => {
    const result = checkMissingProtections("Any lease text at all, security deposit included.", {
      rulePackApplies: false,
    });
    expect(result).toEqual([]);
  });

  it("flags the RLTO summary as not found when there's no mention of it", () => {
    const result = checkMissingProtections("This is a lease with no mention of any city ordinance summary.", {
      rulePackApplies: true,
    });
    const summary = result.find((r) => r.rule_id === "chi-rlto-170-summary");
    expect(summary?.status).toBe("not_found");
    expect(summary?.explanation).toMatch(/we couldn't find/i);
    expect(summary?.explanation).not.toMatch(/the lease does(n't| not) contain/i);
  });

  it("finds the RLTO summary when referenced", () => {
    const result = checkMissingProtections(
      "Attached to this lease is the Residential Landlord and Tenant Ordinance Summary as required by the City.",
      { rulePackApplies: true },
    );
    const summary = result.find((r) => r.rule_id === "chi-rlto-170-summary");
    expect(summary?.status).toBe("found");
  });

  it("recognizes the shorter 'RLTO Summary' phrasing", () => {
    const result = checkMissingProtections("See the attached RLTO Summary for your rights.", {
      rulePackApplies: true,
    });
    const summary = result.find((r) => r.rule_id === "chi-rlto-170-summary");
    expect(summary?.status).toBe("found");
  });

  it("does not evaluate the deposit-bank check when no security deposit is mentioned", () => {
    const result = checkMissingProtections("This lease has no deposit language whatsoever.", {
      rulePackApplies: true,
    });
    expect(result.some((r) => r.rule_id === "chi-rlto-080a3-deposit-bank")).toBe(false);
  });

  it("flags the deposit bank disclosure as not found when a deposit is mentioned but no bank/address is given", () => {
    const result = checkMissingProtections(
      "Tenant shall pay a security deposit of $1,500.00 upon signing this lease.",
      { rulePackApplies: true },
    );
    const deposit = result.find((r) => r.rule_id === "chi-rlto-080a3-deposit-bank");
    expect(deposit?.status).toBe("not_found");
    expect(deposit?.explanation).toMatch(/we couldn't find/i);
  });

  it("finds the deposit bank disclosure when a bank name and street address are given", () => {
    const result = checkMissingProtections(
      "Tenant shall pay a security deposit of $1,500.00, held at First Chicago Bank, 123 Main Street, Chicago, IL.",
      { rulePackApplies: true },
    );
    const deposit = result.find((r) => r.rule_id === "chi-rlto-080a3-deposit-bank");
    expect(deposit?.status).toBe("found");
  });

  it("never uses the word illegal in any explanation", () => {
    const result = checkMissingProtections("A lease with a security deposit and nothing else notable.", {
      rulePackApplies: true,
    });
    for (const r of result) {
      expect(r.explanation.toLowerCase()).not.toMatch(/\billegal/);
    }
  });
});
