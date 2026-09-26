// Batches clauses to the LLM provider, retries once per batch, and collects
// raw (unvalidated) findings. lib/verify.ts is responsible for validating and
// trusting each individual finding - a malformed one here just gets rejected there.
import { ANALYZE_BATCH_SIZE } from "@/lib/config";
import { analyzeBatchResponseSchema } from "@/lib/schemas";
import { ANALYZE_JSON_SCHEMA, buildAnalyzeSystemPrompt, buildAnalyzeUserPrompt } from "@/lib/prompts/analyze.v1";
import { LlmUnavailableError, type LlmProvider } from "@/lib/llm/types";
import type { Clause } from "@/lib/types";

const MAX_CONCURRENT_BATCHES = 3;
const MAX_TOKENS_PER_BATCH = 4096;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface BatchResult {
  raw: unknown[];
  error: Error | null;
}

async function callBatch(batch: Clause[], provider: LlmProvider, rulePackApplies: boolean): Promise<unknown[]> {
  const response = await provider.completeJson({
    task: "analyze_batch",
    system: buildAnalyzeSystemPrompt({ rulePackApplies }),
    user: buildAnalyzeUserPrompt(batch),
    schemaName: "lease_clause_findings",
    jsonSchema: ANALYZE_JSON_SCHEMA,
    maxTokens: MAX_TOKENS_PER_BATCH,
    payload: { clauses: batch, rulePackApplies },
  });
  const parsed = analyzeBatchResponseSchema.parse(response);
  return parsed.findings;
}

/** Runs one batch with a single retry on any error (network, schema mismatch, etc). */
async function runBatch(batch: Clause[], provider: LlmProvider, rulePackApplies: boolean): Promise<BatchResult> {
  try {
    return { raw: await callBatch(batch, provider, rulePackApplies), error: null };
  } catch (firstErr) {
    try {
      return { raw: await callBatch(batch, provider, rulePackApplies), error: null };
    } catch (secondErr) {
      const error = secondErr instanceof Error ? secondErr : new Error(String(secondErr));
      void firstErr;
      return { raw: [], error };
    }
  }
}

export async function analyzeClauses(
  clauses: Clause[],
  ctx: { provider: LlmProvider; rulePackApplies: boolean },
): Promise<{ raw: unknown[]; warnings: string[] }> {
  const batches = chunk(clauses, ANALYZE_BATCH_SIZE);
  const raw: unknown[] = [];
  let failedClauseCount = 0;
  let sawSuccess = false;
  let firstUnavailableError: LlmUnavailableError | null = null;
  let sawNonUnavailableFailure = false;

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES) {
    const slice = batches.slice(i, i + MAX_CONCURRENT_BATCHES);
    const results = await Promise.all(slice.map((batch) => runBatch(batch, ctx.provider, ctx.rulePackApplies)));
    for (let j = 0; j < results.length; j++) {
      const { raw: batchRaw, error } = results[j];
      if (error) {
        failedClauseCount += slice[j].length;
        if (error instanceof LlmUnavailableError) {
          firstUnavailableError ??= error;
        } else {
          sawNonUnavailableFailure = true;
        }
      } else {
        sawSuccess = true;
        raw.push(...batchRaw);
      }
    }
  }

  // Every batch failed, and every failure was the provider being unreachable: surface it.
  if (batches.length > 0 && !sawSuccess && !sawNonUnavailableFailure && firstUnavailableError) {
    throw firstUnavailableError;
  }

  const warnings: string[] = [];
  if (failedClauseCount > 0) {
    warnings.push(
      `${failedClauseCount} clause${failedClauseCount === 1 ? "" : "s"} could not be analyzed (AI service error).`,
    );
  }

  return { raw, warnings };
}
