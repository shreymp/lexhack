// Deterministic, offline "analyzer" used when no LLM credentials are configured.
// It is keyword/regex heuristics only - not legal analysis - and must always be
// clearly labeled as a demo via ProviderInfo.is_mock and the text it produces.
import type { JsonTask, LlmProvider } from "@/lib/llm/types";
import type { Clause, LateFeeBasis, LateFeeExtraction, ProviderInfo, RawClauseFinding } from "@/lib/types";

const MOCK_TAG = "(Demo mode: flagged by a simple keyword match, not a full legal review.)";

// ---------- analyze_batch ----------

interface AnalyzeBatchPayload {
  clauses: Clause[];
  rulePackApplies: boolean;
}

/** Shape of the payload the mock provider expects for a "summarize" task; kept
 * in sync with lib/summarize.ts, which is the only caller. */
export interface SummarizePayload {
  redCount: number;
  yellowCount: number;
  missingNotFoundCount: number;
}

export class MockProvider implements LlmProvider {
  readonly info: ProviderInfo = { name: "mock", model: "keyword-heuristics-v1", is_mock: true };

  async completeJson(t: JsonTask): Promise<unknown> {
    if (t.task === "analyze_batch") {
      const { clauses, rulePackApplies } = t.payload as AnalyzeBatchPayload;
      return { findings: clauses.map((c) => analyzeClauseMock(c, rulePackApplies)) };
    }
    return summarizeMock(t.payload as SummarizePayload);
  }
}

interface ProhibitedMatch {
  ruleId: string;
  matchStart: number;
  matchEnd: number;
  plainEnglish: string;
  reasoning: string;
  suggestedMessage: string;
  needsLateFee: boolean;
}

type Matcher = (text: string) => ProhibitedMatch | null;

function regexMatcher(
  ruleId: string,
  regex: RegExp,
  plainEnglish: string,
  reasoning: string,
  suggestedMessage: string,
  needsLateFee = false,
): Matcher {
  return (text: string) => {
    const m = regex.exec(text);
    if (!m) return null;
    return {
      ruleId,
      matchStart: m.index,
      matchEnd: m.index + m[0].length,
      plainEnglish,
      reasoning,
      suggestedMessage,
      needsLateFee,
    };
  };
}

function depositMatcher(text: string): ProhibitedMatch | null {
  const m = /security\s+deposit/i.exec(text);
  if (!m) return null;
  const dayMatch = text.match(/(\d{2,3})\s*days?/);
  const suspicious =
    /non-?refundable/i.test(text) ||
    /wear\s+and\s+tear/i.test(text) ||
    (dayMatch !== null && Number(dayMatch[1]) > 45);
  if (!suspicious) return null;
  return {
    ruleId: "chi-rlto-080d-deposit-return",
    matchStart: m.index,
    matchEnd: m.index + m[0].length,
    plainEnglish: "This clause describes your security deposit in a way that may not match Chicago's rules.",
    reasoning:
      "Chicago's RLTO requires deposits to be returned within 45 days, minus unpaid rent and damage beyond normal wear and tear - not kept as non-refundable or reduced for ordinary wear and tear.",
    suggestedMessage:
      "Could you confirm the deposit will be returned within 45 days, and that normal wear and tear won't be deducted, as Chicago's RLTO requires?",
    needsLateFee: false,
  };
}

function unequalTerminationMatcher(text: string): ProhibitedMatch | null {
  const landlordMatch = /landlord\s+may\s+(?:terminate|cancel)[^.]{0,80}?(\d+)\s*days?/i.exec(text);
  if (!landlordMatch) return null;
  const tenantMatch = /tenant[^.]{0,80}?(\d+)\s*days?/i.exec(text);
  const landlordDays = Number(landlordMatch[1]);
  const tenantDays = tenantMatch ? Number(tenantMatch[1]) : null;
  if (tenantDays !== null && landlordDays >= tenantDays) return null;
  return {
    ruleId: "chi-rlto-140g-unequal-termination",
    matchStart: landlordMatch.index,
    matchEnd: landlordMatch.index + landlordMatch[0].length,
    plainEnglish: "This clause lets the landlord end the lease on shorter notice than the tenant gets.",
    reasoning:
      "Chicago's RLTO does not allow one side to have a shorter notice or termination period than the other, unless it's disclosed in a separate written notice (which we cannot see here).",
    suggestedMessage:
      "Could we make the termination notice period the same for both of us, or share the separate written disclosure the RLTO requires for this kind of clause?",
    needsLateFee: false,
  };
}

function lateFeeMatcher(text: string): ProhibitedMatch | null {
  const m = /late\s+(?:fee|charge|penalty)/i.exec(text);
  if (!m) return null;
  return {
    ruleId: "chi-rlto-140h-late-fee",
    matchStart: m.index,
    matchEnd: m.index + m[0].length,
    plainEnglish: "This clause charges a fee if rent is paid late.",
    reasoning:
      "Chicago's RLTO caps late fees at $10/month for the first $500 of rent plus 5% of any rent above that. The app checks the numbers in this clause against that cap.",
    suggestedMessage:
      "Could you confirm this late fee doesn't exceed Chicago's RLTO cap ($10 for the first $500 of rent, plus 5% of the rest)?",
    needsLateFee: true,
  };
}

function earlyPaymentDiscountMatcher(text: string): ProhibitedMatch | null {
  const m = /discount|reduction|concession/i.exec(text);
  if (!m) return null;
  if (!/rent/i.test(text)) return null;
  if (!/(early|before|on\s+or\s+before)/i.test(text)) return null;
  return {
    ruleId: "chi-rlto-140i-early-discount",
    matchStart: m.index,
    matchEnd: m.index + m[0].length,
    plainEnglish: "This clause offers a rent discount for paying early, which Chicago caps the same way as a late fee.",
    reasoning:
      "Chicago's RLTO caps an early-payment discount the same way it caps late fees: $10/month for the first $500 of rent plus 5% of any rent above that. The app checks the numbers in this clause against that cap.",
    suggestedMessage: "Could you confirm this early-payment discount doesn't exceed the RLTO's cap on discounts?",
    needsLateFee: true,
  };
}

const PROHIBITED_MATCHERS: Matcher[] = [
  regexMatcher(
    "chi-rlto-140b-confession",
    /confess(?:es|ion)?\s+judg?ment|cognovit|warrant\s+of\s+attorney/i,
    "This clause lets someone confess judgment against you in court.",
    "Chicago's RLTO does not allow a residential lease to let anyone confess judgment against a tenant.",
    "Could we remove the confession-of-judgment language from this lease? I understand Chicago's RLTO doesn't allow that in residential leases.",
  ),
  regexMatcher(
    "chi-rlto-140e-jury-waiver",
    /waives?\s+(?:the\s+)?right\s+(?:to|of)\s+(?:a\s+)?(?:trial\s+by\s+)?jury(?:\s+trial)?|jury\s+trial\s+is\s+(?:hereby\s+)?waived/i,
    "This clause has you give up your right to a jury trial.",
    "Chicago's RLTO does not allow a residential lease to make either party waive the right to a jury trial.",
    "Could we take out the jury-trial waiver in this lease? Chicago's RLTO doesn't allow that clause.",
  ),
  regexMatcher(
    "chi-rlto-140f-attorney-fees",
    /tenant[^.]{0,40}(?:pay|reimburse)[^.]{0,40}attorney'?s?\s+fees|attorney'?s?\s+fees[^.]{0,40}tenant[^.]{0,20}(?:pay|responsible)/i,
    "This clause makes you pay the landlord's attorney's fees if there's a lawsuit.",
    "Chicago's RLTO generally does not allow a lease to make the tenant pay the landlord's attorney's fees.",
    "Could we remove the clause requiring me to pay your attorney's fees in a lawsuit? I understand Chicago's RLTO limits that.",
  ),
  regexMatcher(
    "chi-rlto-140c-liability-limit",
    /landlord\s+(?:shall\s+not|is\s+not|will\s+not)\s+be\s+liable|hold\s+(?:the\s+)?landlord\s+harmless|tenant\s+(?:shall|will)?\s*indemnif(?:y|ies)\s+(?:the\s+)?landlord/i,
    "This clause tries to release the landlord from legal responsibility.",
    "Chicago's RLTO does not allow a lease to limit the landlord's liability that exists under the law.",
    "Could we remove the clause that releases you from liability? I understand Chicago's RLTO doesn't allow limiting landlord liability this way.",
  ),
  regexMatcher(
    "chi-rlto-050-entry-notice",
    /enter\s+(?:the\s+)?(?:premises|unit|apartment|dwelling)?\s*(?:at\s+any\s+time|without\s+(?:notice|prior\s+notice))/i,
    "This clause lets the landlord enter without the notice Chicago's RLTO normally requires.",
    "Chicago's RLTO requires at least 2 days' notice before non-emergency entry; giving that up waives an RLTO right.",
    "Could we change the entry clause so you give at least 2 days' notice, except in emergencies, as Chicago's RLTO requires?",
  ),
  depositMatcher,
  regexMatcher(
    "chi-rlto-140d-notice-waiver",
    /waives?\s+(?:any\s+)?(?:written\s+)?(?:termination\s+of\s+tenancy\s+)?notice|without\s+(?:any\s+)?notice\s+to\s+quit/i,
    "This clause has you give up a required termination notice.",
    "Chicago's RLTO does not allow a lease to make the tenant waive a required written termination notice.",
    "Could we remove the notice waiver? I understand Chicago's RLTO requires certain written notices before termination.",
  ),
  unequalTerminationMatcher,
  lateFeeMatcher,
  earlyPaymentDiscountMatcher,
];

interface OneSidedMatch {
  matchStart: number;
  matchEnd: number;
  plainEnglish: string;
  reasoning: string;
  suggestedMessage: string;
}

function oneSidedMatcher(
  regex: RegExp,
  plainEnglish: string,
  reasoning: string,
  suggestedMessage: string,
): (text: string) => OneSidedMatch | null {
  return (text: string) => {
    const m = regex.exec(text);
    if (!m) return null;
    return { matchStart: m.index, matchEnd: m.index + m[0].length, plainEnglish, reasoning, suggestedMessage };
  };
}

const ONE_SIDED_MATCHERS: ((text: string) => OneSidedMatch | null)[] = [
  oneSidedMatcher(
    /automatic(?:ally)?\s+renew/i,
    "This clause renews the lease automatically unless you act by a deadline.",
    "Automatic renewal clauses are common but can be easy to miss, and the deadline to opt out is often short.",
    "Could you clarify how much notice I'll get before this lease automatically renews, and how I can opt out?",
  ),
  oneSidedMatcher(
    /non-?refundable/i,
    "This clause charges a fee that is described as non-refundable.",
    "A non-refundable fee is unusual and worth understanding before you sign, especially if it's more than a small amount.",
    "Could you explain why this fee is non-refundable and under what circumstances, if any, it could be returned?",
  ),
  oneSidedMatcher(
    /tenant\s+(?:is|shall\s+be|will\s+be)\s+responsible\s+for\s+(?:any\s+and\s+)?all\s+repairs/i,
    "This clause puts all repair costs on you, even ones normally the landlord's job.",
    "Putting every repair on the tenant, with no carve-out for the landlord's own maintenance duties, is unusually broad.",
    "Could we clarify which repairs are my responsibility versus the landlord's, especially for normal wear and major systems?",
  ),
  oneSidedMatcher(
    /guests?\s+(?:may\s+not|shall\s+not|must\s+not)\s+(?:stay|remain)|guests?\s+(?:are\s+)?limited\s+to/i,
    "This clause limits how long guests can stay.",
    "Guest-limit clauses are common, but a strict or unclear limit is worth understanding upfront.",
    "Could you clarify the guest policy - how many days a guest can stay before I need approval?",
  ),
  oneSidedMatcher(
    /rent\s+may\s+(?:be\s+)?increase[d]?\s+at\s+(?:the\s+)?landlord'?s?\s+(?:sole\s+)?discretion|landlord\s+may\s+increase\s+(?:the\s+)?rent\s+at\s+any\s+time/i,
    "This clause lets the landlord raise the rent at their discretion.",
    "A rent-increase clause with no stated limit or process gives the landlord broad, unpredictable discretion.",
    "Could you clarify how and when rent increases will be decided and communicated during the lease term?",
  ),
];

function extractLateFee(text: string): LateFeeExtraction {
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const perDay = /per\s+day|\/\s*day|each\s+day|daily/i.test(text);
  const flatMatch = text.match(/\$\s*(\d+(?:\.\d+)?)/);
  const maxDaysMatch = text.match(/(?:up\s+to|maximum\s+of|for\s+a\s+maximum\s+of)\s+(\d+)\s*days?/i);
  const rentMatch = text.match(/rent\s+(?:of|is)\s+\$?\s*(\d+(?:\.\d+)?)/i);

  let basis: LateFeeBasis = "other";
  let amount: number | null = null;
  let initial_flat_amount: number | null = null;

  if (percentMatch) {
    basis = "percent_of_rent";
    amount = Number(percentMatch[1]);
  } else if (perDay) {
    basis = "per_day";
    amount = flatMatch ? Number(flatMatch[1]) : null;
  } else if (flatMatch) {
    basis = "flat_per_occurrence";
    amount = Number(flatMatch[1]);
    initial_flat_amount = amount;
  }

  return {
    basis,
    amount,
    initial_flat_amount,
    max_days: maxDaysMatch ? Number(maxDaysMatch[1]) : null,
    monthly_rent_in_clause: rentMatch ? Number(rentMatch[1]) : null,
  };
}

/** Expands a match to the sentence containing it, trimmed to <= 300 chars, and
 * guaranteed to be a verbatim substring of `text` (so it survives verify.ts). */
function extractQuote(text: string, matchStart: number, matchEnd: number): string {
  const enderRe = /[.!?]/;
  let start = matchStart;
  while (start > 0 && !enderRe.test(text[start - 1])) start--;
  let end = matchEnd;
  while (end < text.length && !enderRe.test(text[end])) end++;
  if (end < text.length) end++; // include the punctuation mark itself
  let quote = text.slice(start, end).trim();
  if (quote.length === 0) quote = text.slice(matchStart, Math.max(matchEnd, matchStart + 1)).trim();
  if (quote.length > 300) quote = quote.slice(0, 300).trim();
  if (quote.length === 0) quote = text.slice(0, Math.min(text.length, 300)).trim();
  return quote;
}

function analyzeClauseMock(clause: Clause, rulePackApplies: boolean): RawClauseFinding {
  const text = clause.text;

  for (const matcher of PROHIBITED_MATCHERS) {
    const match = matcher(text);
    if (!match) continue;
    const quote = extractQuote(text, match.matchStart, match.matchEnd);
    const lateFee = match.needsLateFee ? extractLateFee(text) : null;

    if (rulePackApplies) {
      return {
        clause_id: clause.id,
        quote,
        plain_english: match.plainEnglish,
        label: "likely_unenforceable",
        rule_id: match.ruleId,
        reasoning: `${match.reasoning} ${MOCK_TAG}`,
        suggested_message: match.suggestedMessage,
        late_fee: lateFee,
      };
    }
    return {
      clause_id: clause.id,
      quote,
      plain_english: match.plainEnglish,
      label: "one_sided",
      rule_id: null,
      reasoning: `${match.reasoning} This would normally point to a Chicago RLTO rule, but that rule pack doesn't apply to this lease based on your answers, so we can't cite it here. ${MOCK_TAG}`,
      suggested_message: match.suggestedMessage,
      late_fee: lateFee,
    };
  }

  for (const matcher of ONE_SIDED_MATCHERS) {
    const match = matcher(text);
    if (!match) continue;
    return {
      clause_id: clause.id,
      quote: extractQuote(text, match.matchStart, match.matchEnd),
      plain_english: match.plainEnglish,
      label: "one_sided",
      rule_id: null,
      reasoning: `${match.reasoning} ${MOCK_TAG}`,
      suggested_message: match.suggestedMessage,
      late_fee: null,
    };
  }

  return {
    clause_id: clause.id,
    quote: extractQuote(text, 0, 0),
    plain_english: "This clause looks like a standard lease term based on a simple keyword check.",
    label: "standard",
    rule_id: null,
    reasoning: `No red-flag or unusual language was detected by the demo keyword check. ${MOCK_TAG}`,
    suggested_message: null,
    late_fee: null,
  };
}

// ---------- summarize ----------

function summarizeMock(payload: SummarizePayload): { summary: string; questions_to_ask: string[] } {
  const { redCount, yellowCount, missingNotFoundCount } = payload;
  const prefix = "Demo mode (keyword-based, not an AI model):";

  if (redCount === 0 && yellowCount === 0 && missingNotFoundCount === 0) {
    return {
      summary: `${prefix} we didn't flag any clauses as likely unenforceable or one-sided, and we didn't find any missing protections among the ones we checked. A clean result like this doesn't guarantee the lease is fair - it only reflects the limited keyword checks this demo runs.`,
      questions_to_ask: [
        "Is there anything discussed but not written into this lease that I should get in writing?",
        "What is the exact process and timeline for getting my security deposit back?",
        "Who do I contact, and how quickly, if something needs repair?",
      ],
    };
  }

  const parts: string[] = [];
  if (redCount > 0) parts.push(`${redCount} clause${redCount === 1 ? "" : "s"} may be likely unenforceable`);
  if (yellowCount > 0) parts.push(`${yellowCount} clause${yellowCount === 1 ? "" : "s"} looked one-sided`);
  if (missingNotFoundCount > 0) {
    parts.push(
      `${missingNotFoundCount} protection${missingNotFoundCount === 1 ? "" : "s"} we checked for could not be found in the lease`,
    );
  }

  const questions = ["Could you walk me through the clauses that were flagged and why they're written that way?"];
  if (redCount > 0) {
    questions.push("Would you be willing to remove or revise the clauses flagged as likely unenforceable?");
  }
  if (missingNotFoundCount > 0) {
    questions.push("Can you add the missing protections directly into the lease text?");
  }
  questions.push("What is the exact process and timeline for getting my security deposit back?");
  questions.push("Who do I contact, and how quickly, if something needs repair?");

  return {
    summary: `${prefix} ${parts.join(", ")}. Review the highlighted clauses below before you sign.`,
    questions_to_ask: questions.slice(0, 6),
  };
}
