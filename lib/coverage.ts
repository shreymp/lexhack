// Decides whether the Chicago RLTO rule pack applies at all, based on the
// renter's answers to the three screening questions on the upload page.
import type { Coverage, CoverageAnswers } from "@/lib/types";

const EXCLUSION_CITATION = "§ 5-12-020";

export function evaluateCoverage(answers: CoverageAnswers): Coverage {
  const { in_chicago, owner_occupied_six_or_fewer, other_exclusion } = answers;

  const excluded = in_chicago === "no" || owner_occupied_six_or_fewer === "yes" || other_exclusion === "yes";
  const rulePackApplies = !excluded;
  const uncertain =
    rulePackApplies &&
    (in_chicago === "unsure" || owner_occupied_six_or_fewer === "unsure" || other_exclusion === "unsure");

  const reason = buildReason(answers, rulePackApplies, uncertain);

  return {
    answers,
    rule_pack_applies: rulePackApplies,
    uncertain,
    reason,
  };
}

function buildReason(answers: CoverageAnswers, applies: boolean, uncertain: boolean): string {
  const { in_chicago, owner_occupied_six_or_fewer, other_exclusion } = answers;

  if (!applies) {
    if (in_chicago === "no") {
      return (
        "You said this rental isn't in Chicago. The Chicago RLTO only covers rentals inside Chicago city limits " +
        `(${EXCLUSION_CITATION}), so we won't label any clause as likely unenforceable — we'll only point out one-sided terms.`
      );
    }
    if (owner_occupied_six_or_fewer === "yes") {
      return (
        "You said the owner lives in the building and it has six or fewer units. The Chicago RLTO generally " +
        `doesn't cover those rentals (${EXCLUSION_CITATION}(a)), so we won't label any clause as likely unenforceable — ` +
        "we'll only point out one-sided terms."
      );
    }
    // other_exclusion === "yes"
    return (
      "You said this rental is one of the other excluded types (e.g. hotel/motel, dorm, cooperative, or " +
      `employee housing). The Chicago RLTO generally doesn't cover those (${EXCLUSION_CITATION}), so we won't label ` +
      "any clause as likely unenforceable — we'll only point out one-sided terms."
    );
  }

  if (uncertain) {
    return (
      "Based on your answers, the Chicago RLTO probably applies to this rental, but you weren't sure about " +
      `everything that affects coverage (${EXCLUSION_CITATION}). We'll go ahead and check the lease against the RLTO, ` +
      "but double-check these exclusions apply to you before relying on any \"likely unenforceable\" label."
    );
  }

  return (
    "Based on your answers, the Chicago RLTO applies to this rental, so we'll check the lease against it and " +
    "flag clauses that appear to violate it."
  );
}
