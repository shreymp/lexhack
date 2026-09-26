import { describe, expect, it } from "vitest";
import { evaluateCoverage } from "@/lib/coverage";
import type { CoverageAnswers } from "@/lib/types";

function answers(overrides: Partial<CoverageAnswers>): CoverageAnswers {
  return {
    in_chicago: "yes",
    owner_occupied_six_or_fewer: "no",
    other_exclusion: "no",
    ...overrides,
  };
}

describe("evaluateCoverage", () => {
  it("applies when in Chicago and no exclusions", () => {
    const c = evaluateCoverage(answers({}));
    expect(c.rule_pack_applies).toBe(true);
    expect(c.uncertain).toBe(false);
  });

  it("does not apply when not in Chicago", () => {
    const c = evaluateCoverage(answers({ in_chicago: "no" }));
    expect(c.rule_pack_applies).toBe(false);
    expect(c.uncertain).toBe(false);
    expect(c.reason).toMatch(/§ 5-12-020/);
  });

  it("does not apply when owner-occupied with six or fewer units", () => {
    const c = evaluateCoverage(answers({ owner_occupied_six_or_fewer: "yes" }));
    expect(c.rule_pack_applies).toBe(false);
    expect(c.reason).toMatch(/owner lives in the building/i);
    expect(c.reason).toMatch(/§ 5-12-020\(a\)/);
  });

  it("does not apply for other exclusions", () => {
    const c = evaluateCoverage(answers({ other_exclusion: "yes" }));
    expect(c.rule_pack_applies).toBe(false);
    expect(c.reason).toMatch(/§ 5-12-020/);
  });

  it("is uncertain when it applies but an answer is unsure", () => {
    const c = evaluateCoverage(answers({ owner_occupied_six_or_fewer: "unsure" }));
    expect(c.rule_pack_applies).toBe(true);
    expect(c.uncertain).toBe(true);
  });

  it("is not uncertain when an unsure answer would exclude coverage anyway (exclusion answers take priority)", () => {
    // in_chicago "no" definitively excludes -- rule pack does not apply regardless of other unsure answers.
    const c = evaluateCoverage(answers({ in_chicago: "no", other_exclusion: "unsure" }));
    expect(c.rule_pack_applies).toBe(false);
    expect(c.uncertain).toBe(false);
  });

  it("never mentions the word illegal", () => {
    for (const a of [
      answers({}),
      answers({ in_chicago: "no" }),
      answers({ owner_occupied_six_or_fewer: "yes" }),
      answers({ other_exclusion: "yes" }),
      answers({ in_chicago: "unsure" }),
    ]) {
      expect(evaluateCoverage(a).reason.toLowerCase()).not.toMatch(/\billegal/);
    }
  });
});
