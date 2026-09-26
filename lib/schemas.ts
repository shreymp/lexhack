// zod schemas for untrusted LLM output. Validate before anything reaches verify.ts.
import { z } from "zod";

export const riskLabelSchema = z.enum(["likely_unenforceable", "one_sided", "standard"]);

export const lateFeeExtractionSchema = z.object({
  basis: z.enum(["flat_per_occurrence", "per_day", "percent_of_rent", "other"]),
  amount: z.number().nullable(),
  initial_flat_amount: z.number().nullable(),
  max_days: z.number().nullable(),
  monthly_rent_in_clause: z.number().nullable(),
});

export const rawClauseFindingSchema = z.object({
  clause_id: z.string(),
  quote: z.string().min(1),
  plain_english: z.string().min(1),
  label: riskLabelSchema,
  rule_id: z.string().nullable(),
  reasoning: z.string(),
  suggested_message: z.string().nullable(),
  late_fee: lateFeeExtractionSchema.nullable(),
});

/** Shape of one analyzer call's response (one batch of clauses). */
export const analyzeBatchResponseSchema = z.object({
  findings: z.array(z.unknown()), // each element validated individually so one bad item doesn't sink the batch
});

export const summaryResponseSchema = z.object({
  summary: z.string(),
  questions_to_ask: z.array(z.string()),
});

export type RawClauseFindingParsed = z.infer<typeof rawClauseFindingSchema>;
