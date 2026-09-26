// Calls the provider for a whole-lease summary; always falls back to a
// deterministic, counts-based summary instead of throwing.
import { summaryResponseSchema } from "@/lib/schemas";
import { buildSummarizeSystemPrompt, buildSummarizeUserPrompt, SUMMARIZE_JSON_SCHEMA } from "@/lib/prompts/summarize.v1";
import type { LlmProvider } from "@/lib/llm/types";
import type { Clause, ClauseFinding, MissingProtection } from "@/lib/types";

const MAX_TOKENS = 1024;

interface SummarizeCtx {
  provider: LlmProvider;
  clauses: Clause[];
  findings: ClauseFinding[];
  missing: MissingProtection[];
}

function counts(ctx: Pick<SummarizeCtx, "findings" | "missing">) {
  return {
    redCount: ctx.findings.filter((f) => f.label === "likely_unenforceable").length,
    yellowCount: ctx.findings.filter((f) => f.label === "one_sided").length,
    missingNotFoundCount: ctx.missing.filter((m) => m.status === "not_found").length,
  };
}

function fallbackSummary(ctx: Pick<SummarizeCtx, "findings" | "missing">): {
  summary: string;
  questions_to_ask: string[];
} {
  const { redCount, yellowCount, missingNotFoundCount } = counts(ctx);

  if (redCount === 0 && yellowCount === 0 && missingNotFoundCount === 0) {
    return {
      summary:
        "We didn't flag any clauses as likely unenforceable or one-sided, and we didn't find any missing protections among the ones we checked. A clean result like this doesn't guarantee the lease is fair - it only reflects the limited set of things this tool checks.",
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
    summary: `${parts.join(", ")}. Review the highlighted clauses below before you sign.`,
    questions_to_ask: questions.slice(0, 6),
  };
}

export async function summarize(
  ctx: SummarizeCtx,
): Promise<{ summary: string; questions_to_ask: string[] }> {
  try {
    const response = await ctx.provider.completeJson({
      task: "summarize",
      system: buildSummarizeSystemPrompt(),
      user: buildSummarizeUserPrompt({ clauses: ctx.clauses, findings: ctx.findings, missing: ctx.missing }),
      schemaName: "lease_summary",
      jsonSchema: SUMMARIZE_JSON_SCHEMA,
      maxTokens: MAX_TOKENS,
      payload: counts(ctx),
    });
    const parsed = summaryResponseSchema.parse(response);
    if (parsed.questions_to_ask.length < 3 || parsed.questions_to_ask.length > 6 || parsed.summary.trim() === "") {
      return fallbackSummary(ctx);
    }
    return parsed;
  } catch {
    return fallbackSummary(ctx);
  }
}
