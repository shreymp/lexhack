// Deterministic checks for things the RLTO requires that a lease might be
// silent about. These never claim certainty -- a "not_found" only ever means
// "we couldn't find a mention of it," since a real lease attachment (e.g. the
// RLTO summary) might just not be part of the text we were given.
import type { MissingProtection } from "@/lib/types";
import { getRule } from "@/lib/rules";

const SUMMARY_RULE_ID = "chi-rlto-170-summary";
const DEPOSIT_BANK_RULE_ID = "chi-rlto-080a3-deposit-bank";

// Tolerant of the several ways a lease/rider might reference the City's
// official RLTO summary attachment.
const RE_RLTO_SUMMARY =
  /residential landlord and tenant ordinance summary|rlto summary|summary of the residential landlord and tenant ordinance|(chicago residential landlord and tenant ordinance)[\s\S]{0,80}?(summary|attached)/i;

const RE_SECURITY_DEPOSIT = /security deposit/i;

// A bank/financial-institution name near deposit language, followed by
// something address-like (a street number). Conservative on purpose: when in
// doubt this returns not_found rather than risking a false "found".
const RE_BANK_NEAR_DEPOSIT =
  /(bank|credit union|savings(?:\s+(?:and|&)\s+loan)?|financial institution)[^.\n]{0,80}?\d{1,6}\s+[A-Za-z0-9.'\s]{2,40}(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|place|pl\.?)/i;

export function checkMissingProtections(
  sourceText: string,
  ctx: { rulePackApplies: boolean },
): MissingProtection[] {
  if (!ctx.rulePackApplies) return [];

  const results: MissingProtection[] = [];

  results.push(checkRltoSummary(sourceText));

  const depositCheck = checkDepositBank(sourceText);
  if (depositCheck) results.push(depositCheck);

  return results;
}

function checkRltoSummary(sourceText: string): MissingProtection {
  const rule = getRule(SUMMARY_RULE_ID);
  const title = rule?.title ?? "RLTO summary must be attached";
  const found = RE_RLTO_SUMMARY.test(sourceText);

  if (found) {
    return {
      rule_id: SUMMARY_RULE_ID,
      title,
      status: "found",
      explanation: "The lease text references the City's RLTO summary.",
      what_to_ask: "",
    };
  }

  return {
    rule_id: SUMMARY_RULE_ID,
    title,
    status: "not_found",
    explanation:
      "We couldn't find a mention of the City's RLTO summary. Chicago landlords must attach it to every " +
      "written lease (§ 5-12-170). It may just be a separate page — ask for it.",
    what_to_ask: "Could you send me the City of Chicago Residential Landlord and Tenant Ordinance summary that's supposed to come with this lease?",
  };
}

/** Only evaluated if the lease mentions a security deposit at all. */
function checkDepositBank(sourceText: string): MissingProtection | null {
  if (!RE_SECURITY_DEPOSIT.test(sourceText)) return null;

  const rule = getRule(DEPOSIT_BANK_RULE_ID);
  const title = rule?.title ?? "Where your security deposit is held";
  const found = RE_BANK_NEAR_DEPOSIT.test(sourceText);

  if (found) {
    return {
      rule_id: DEPOSIT_BANK_RULE_ID,
      title,
      status: "found",
      explanation: "The lease mentions a security deposit and appears to name a bank or financial institution and an address for it.",
      what_to_ask: "",
    };
  }

  return {
    rule_id: DEPOSIT_BANK_RULE_ID,
    title,
    status: "not_found",
    explanation:
      "We couldn't find the name and address of the bank or financial institution holding your security " +
      "deposit. Chicago leases must disclose this (§ 5-12-080(a)(3)).",
    what_to_ask: "Which bank or financial institution is my security deposit held at, and what's its address?",
  };
}
