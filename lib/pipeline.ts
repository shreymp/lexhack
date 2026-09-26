// Orchestrates the full pipeline: normalize -> segment -> coverage -> rent
// resolution -> LLM analysis -> verification -> missing protections -> summary.
import { normalizeSourceText } from "@/lib/text";
import { segmentClauses } from "@/lib/segment";
import { evaluateCoverage } from "@/lib/coverage";
import { findMonthlyRent } from "@/lib/latefee";
import { verifyFindings } from "@/lib/verify";
import { checkMissingProtections } from "@/lib/missing";
import { analyzeClauses } from "@/lib/analyze";
import { summarize } from "@/lib/summarize";
import { getProvider } from "@/lib/llm";
import { RULE_PACK } from "@/lib/rules";
import { MAX_SOURCE_CHARS } from "@/lib/types";
import type { AnalysisResult, CoverageAnswers } from "@/lib/types";
import type { LlmProvider } from "@/lib/llm/types";

/** Thrown when the normalized lease text exceeds MAX_SOURCE_CHARS. The API route maps this to code "too_long". */
export class SourceTooLongError extends Error {
  readonly length: number;
  readonly max: number;

  constructor(length: number, max: number) {
    super(`The lease text is ${length.toLocaleString()} characters, which is over the ${max.toLocaleString()}-character limit.`);
    this.name = "SourceTooLongError";
    this.length = length;
    this.max = max;
  }
}

export async function runAnalysis(input: {
  sourceText: string;
  sourceKind: "pdf" | "text";
  coverage: CoverageAnswers;
  monthlyRent: number | null;
  provider?: LlmProvider;
}): Promise<AnalysisResult> {
  const normalized = normalizeSourceText(input.sourceText);
  if (normalized.length > MAX_SOURCE_CHARS) {
    throw new SourceTooLongError(normalized.length, MAX_SOURCE_CHARS);
  }

  const clauses = segmentClauses(normalized);
  const coverage = evaluateCoverage(input.coverage);

  const rent: { amount: number | null; source: "user" | "lease_text" | null } =
    input.monthlyRent != null
      ? { amount: input.monthlyRent, source: "user" }
      : ((): { amount: number | null; source: "user" | "lease_text" | null } => {
          const found = findMonthlyRent(normalized);
          return found != null ? { amount: found, source: "lease_text" } : { amount: null, source: null };
        })();

  const provider = input.provider ?? getProvider();

  const { raw, warnings: analyzeWarnings } = await analyzeClauses(clauses, {
    provider,
    rulePackApplies: coverage.rule_pack_applies,
  });

  const { findings, stats } = verifyFindings(raw, {
    clauses,
    sourceText: normalized,
    rulePackApplies: coverage.rule_pack_applies,
    rent,
  });

  const missing = checkMissingProtections(normalized, { rulePackApplies: coverage.rule_pack_applies });

  const { summary, questions_to_ask } = await summarize({ provider, clauses, findings, missing });

  const warnings = [...analyzeWarnings];
  if (provider.info.is_mock) {
    warnings.push("Demo mode: results come from simple keyword rules, not an AI model.");
  }

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    source_kind: input.sourceKind,
    source_text: normalized,
    clauses,
    findings,
    missing,
    summary,
    questions_to_ask,
    coverage,
    stats,
    provider: provider.info,
    rule_pack: {
      id: RULE_PACK.id,
      name: RULE_PACK.name,
      version: RULE_PACK.version,
      date_verified: RULE_PACK.date_verified,
      caveats: RULE_PACK.caveats,
    },
    warnings,
  };
}
