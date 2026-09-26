// Verifies raw LLM output against the actual lease text and the rule pack.
// Nothing here trusts the model: quotes must be locatable verbatim (or
// whitespace/punctuation-tolerant) in the source, and "likely_unenforceable"
// must cite a real prohibited_provision rule -- or it gets downgraded.
import { rawClauseFindingSchema } from "@/lib/schemas";
import { getRule } from "@/lib/rules";
import { checkLateFee } from "@/lib/latefee";
import { normalizeForMatch } from "@/lib/text";
import type {
  Clause,
  ClauseFinding,
  LateFeeCheck,
  RejectedFinding,
  RiskLabel,
  VerificationStats,
} from "@/lib/types";

const LATE_FEE_RULE_ID = "chi-rlto-140h-late-fee";
const EARLY_DISCOUNT_RULE_ID = "chi-rlto-140i-early-discount";
const LATE_FEE_RULE_IDS = new Set([LATE_FEE_RULE_ID, EARLY_DISCOUNT_RULE_ID]);

/** Quotes shorter than this (and not the whole clause) are too short to reliably anchor. */
const MIN_QUOTE_CHARS = 12;

// The word "illegal(ly)" must never reach the UI (see hard rule #3). We keep
// this honest by softening rather than deleting -- "improperly" and "likely
// unenforceable" both leave the actual legal conclusion to the rule citation.
export function sanitizeText(s: string): string {
  return s.replace(/\billegally\b/gi, "improperly").replace(/\billegal\b/gi, "likely unenforceable");
}

interface QuoteLocation {
  quote_start: number;
  quote_end: number;
  quote_match: "exact" | "whitespace_normalized";
}

/** Per-character punctuation normalization that preserves 1:1 index alignment (unlike collapsing whitespace). */
function normalizeCharForMatch(c: string): string {
  if (/[‘’‚‛]/.test(c)) return "'";
  if (/[“”„‟]/.test(c)) return '"';
  if (/[–—]/.test(c)) return "-";
  return c;
}

/**
 * Builds a whitespace-collapsed version of `haystack` alongside a map from
 * each character of that collapsed string back to the [start, end) range of
 * original characters it stands for, so a match found in the collapsed
 * string can be mapped back to exact offsets in the original.
 */
function buildCollapsedIndex(haystack: string): { collapsed: string; ranges: { start: number; end: number }[] } {
  let collapsed = "";
  const ranges: { start: number; end: number }[] = [];
  let i = 0;
  while (i < haystack.length) {
    const c = haystack[i];
    if (/\s/.test(c)) {
      const runStart = i;
      while (i < haystack.length && /\s/.test(haystack[i])) i++;
      collapsed += " ";
      ranges.push({ start: runStart, end: i });
    } else {
      collapsed += normalizeCharForMatch(c);
      ranges.push({ start: i, end: i + 1 });
      i++;
    }
  }
  return { collapsed, ranges };
}

/** Whitespace/punctuation-tolerant substring search, mapped back to exact offsets in `haystack`. */
function findFuzzyQuote(haystack: string, needle: string): { start: number; end: number } | null {
  const needleNormalized = normalizeForMatch(needle);
  if (!needleNormalized) return null;

  const { collapsed, ranges } = buildCollapsedIndex(haystack);
  const p = collapsed.indexOf(needleNormalized);
  if (p === -1) return null;

  const start = ranges[p].start;
  const end = ranges[p + needleNormalized.length - 1].end;
  return { start, end };
}

/**
 * Locates a quote in the source text. Order of attempts (spec): exact
 * substring within the clause, then whitespace-tolerant within the clause,
 * then (last resort) the same two strategies against the whole document.
 */
function locateQuote(quote: string, clause: Clause, sourceText: string): QuoteLocation | null {
  const idxInClause = clause.text.indexOf(quote);
  if (idxInClause !== -1) {
    return {
      quote_start: clause.start + idxInClause,
      quote_end: clause.start + idxInClause + quote.length,
      quote_match: "exact",
    };
  }

  const fuzzyInClause = findFuzzyQuote(clause.text, quote);
  if (fuzzyInClause) {
    return {
      quote_start: clause.start + fuzzyInClause.start,
      quote_end: clause.start + fuzzyInClause.end,
      quote_match: "whitespace_normalized",
    };
  }

  const idxInDoc = sourceText.indexOf(quote);
  if (idxInDoc !== -1) {
    return { quote_start: idxInDoc, quote_end: idxInDoc + quote.length, quote_match: "exact" };
  }

  const fuzzyInDoc = findFuzzyQuote(sourceText, quote);
  if (fuzzyInDoc) {
    return { quote_start: fuzzyInDoc.start, quote_end: fuzzyInDoc.end, quote_match: "whitespace_normalized" };
  }

  return null;
}

function safeString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function verifyFindings(
  raw: unknown[],
  ctx: {
    clauses: Clause[];
    sourceText: string;
    rulePackApplies: boolean;
    rent: { amount: number | null; source: "user" | "lease_text" | null };
  },
): { findings: ClauseFinding[]; stats: VerificationStats } {
  const clauseById = new Map(ctx.clauses.map((c) => [c.id, c]));
  const claimedClauseIds = new Set<string>();
  const rejected: RejectedFinding[] = [];
  const accepted: ClauseFinding[] = [];
  const downgradedFlags: boolean[] = [];

  for (const item of raw) {
    // a. schema validation
    const parsedResult = rawClauseFindingSchema.safeParse(item);
    if (!parsedResult.success) {
      const obj = item as Record<string, unknown> | null;
      rejected.push({
        clause_id: obj && typeof obj === "object" ? safeString(obj.clause_id) : "",
        quote: obj && typeof obj === "object" ? safeString(obj.quote) : "",
        reason: "schema_invalid",
      });
      continue;
    }
    const parsed = parsedResult.data;

    // b. clause must exist, and only the first finding per clause is kept
    const claimedClause = clauseById.get(parsed.clause_id);
    if (!claimedClause) {
      rejected.push({ clause_id: parsed.clause_id, quote: parsed.quote, reason: "unknown_clause_id" });
      continue;
    }

    // c. quote must be locatable verbatim (or whitespace/punctuation-tolerant)
    const trimmedQuote = parsed.quote.trim();
    const isEntireClause = trimmedQuote === claimedClause.text.trim();
    // Short quotes are too easy to anchor to the wrong spot by accident (a
    // stray "rent." could "match" all over the lease), so unless the model
    // quoted the whole (short) clause, we require at least MIN_QUOTE_CHARS.
    const tooShort = trimmedQuote.length < MIN_QUOTE_CHARS && !isEntireClause;

    const location = tooShort ? null : locateQuote(parsed.quote, claimedClause, ctx.sourceText);
    if (!location) {
      rejected.push({ clause_id: parsed.clause_id, quote: parsed.quote, reason: "quote_not_found" });
      continue;
    }

    // If the quote was only found elsewhere in the document, the model mis-assigned
    // the clause. Attach the finding to the clause that actually contains the quote,
    // so the highlight and the sidebar entry always point at the same text.
    const clause =
      location.quote_start >= claimedClause.start && location.quote_end <= claimedClause.end
        ? claimedClause
        : ctx.clauses.find((c) => location.quote_start >= c.start && location.quote_end <= c.end);
    if (!clause) {
      // Quote spans a clause boundary -- can't anchor it to one clause.
      rejected.push({ clause_id: parsed.clause_id, quote: parsed.quote, reason: "quote_not_found" });
      continue;
    }
    if (claimedClauseIds.has(clause.id)) {
      rejected.push({ clause_id: clause.id, quote: parsed.quote, reason: "duplicate" });
      continue;
    }
    claimedClauseIds.add(clause.id);

    // d. rule check for likely_unenforceable
    let label: RiskLabel = parsed.label;
    let ruleId: string | null = parsed.rule_id;
    let labelAdjusted: { from: RiskLabel; reason: string } | null = null;
    let citationDowngraded = false;

    if (label === "likely_unenforceable") {
      if (!ctx.rulePackApplies) {
        labelAdjusted = { from: label, reason: "The Chicago RLTO may not cover this rental, so we can't cite it." };
        label = "one_sided";
        ruleId = null;
        citationDowngraded = true;
      } else {
        const rule = getRule(ruleId);
        if (!ruleId || !rule || rule.kind !== "prohibited_provision") {
          labelAdjusted = {
            from: label,
            reason: "No matching rule in the rule pack, so we can't call it unenforceable.",
          };
          label = "one_sided";
          ruleId = null;
          citationDowngraded = true;
        }
      }
    } else {
      ruleId = null; // force null when label isn't likely_unenforceable
    }

    // e. deterministic late-fee/early-discount cap check
    let lateFeeCheck: LateFeeCheck | null = null;
    if (parsed.late_fee == null && ruleId != null && LATE_FEE_RULE_IDS.has(ruleId)) {
      // The cap is decided by code, not the model. Without extracted numbers we
      // can't run the check, so we abstain from the citation.
      labelAdjusted = {
        from: label,
        reason: "We couldn't read the fee amount from this clause, so we can't check it against the cap.",
      };
      label = "one_sided";
      ruleId = null;
      citationDowngraded = true;
    }
    if (parsed.late_fee != null) {
      lateFeeCheck = checkLateFee(parsed.late_fee, ctx.rent);

      if (lateFeeCheck.over_cap === true && ctx.rulePackApplies) {
        const chosenRuleId = ruleId === EARLY_DISCOUNT_RULE_ID ? EARLY_DISCOUNT_RULE_ID : LATE_FEE_RULE_ID;
        if (label !== "likely_unenforceable" || ruleId !== chosenRuleId) {
          labelAdjusted = {
            from: label,
            reason: `This charge is above the Chicago cap. ${lateFeeCheck.explanation}`,
          };
        }
        label = "likely_unenforceable";
        ruleId = chosenRuleId;
      } else if (lateFeeCheck.over_cap === false && ruleId != null && LATE_FEE_RULE_IDS.has(ruleId)) {
        labelAdjusted = { from: label, reason: `Within the Chicago cap: ${lateFeeCheck.explanation}` };
        label = "standard";
        ruleId = null;
        citationDowngraded = true;
      } else if (lateFeeCheck.over_cap === null && ruleId != null && LATE_FEE_RULE_IDS.has(ruleId)) {
        labelAdjusted = {
          from: label,
          reason: "Couldn't confirm the rent amount, so we can't check the cap.",
        };
        label = "one_sided";
        ruleId = null;
        citationDowngraded = true;
      }
    }

    // f. standard clauses never carry a suggested message
    let suggestedMessage = parsed.suggested_message;
    if (label === "standard") suggestedMessage = null;

    // g. sanitize user-facing strings (never say "illegal(ly)")
    const plainEnglish = sanitizeText(parsed.plain_english);
    const reasoning = sanitizeText(parsed.reasoning);
    suggestedMessage = suggestedMessage != null ? sanitizeText(suggestedMessage) : null;
    if (labelAdjusted) labelAdjusted = { ...labelAdjusted, reason: sanitizeText(labelAdjusted.reason) };

    accepted.push({
      clause_id: clause.id,
      quote: ctx.sourceText.slice(location.quote_start, location.quote_end),
      quote_start: location.quote_start,
      quote_end: location.quote_end,
      plain_english: plainEnglish,
      label,
      rule_id: ruleId,
      reasoning,
      suggested_message: suggestedMessage,
      late_fee_check: lateFeeCheck,
      verification: {
        quote_match: location.quote_match,
        label_adjusted: labelAdjusted,
      },
    });

    downgradedFlags.push(citationDowngraded);
  }

  const ruleCitationsDowngraded = downgradedFlags.filter(Boolean).length;

  const sorted = [...accepted].sort((a, b) => {
    const ai = clauseById.get(a.clause_id)?.index ?? 0;
    const bi = clauseById.get(b.clause_id)?.index ?? 0;
    return ai - bi;
  });

  const stats: VerificationStats = {
    findings_received: raw.length,
    findings_accepted: accepted.length,
    quotes_rejected: rejected.filter((r) => r.reason === "quote_not_found").length,
    rule_citations_downgraded: ruleCitationsDowngraded,
    rejected,
  };

  return { findings: sorted, stats };
}
