// Shared contracts for the whole pipeline. Every module imports from here.
// Changing a type here is a cross-team change: update all producers/consumers.

/** Risk labels. The UI must never use the word "illegal". */
export type RiskLabel = "likely_unenforceable" | "one_sided" | "standard";

/** A contiguous span of the source text. Invariant: text === sourceText.slice(start, end). */
export interface Clause {
  id: string; // "c1", "c2", ... in document order
  index: number; // 0-based position in document order
  heading: string | null; // e.g. "12." or "12(a)" or "LATE CHARGES" if detected
  text: string;
  start: number; // inclusive char offset into sourceText
  end: number; // exclusive char offset into sourceText
}

// ---------- Rule pack ----------

export interface Rule {
  id: string; // e.g. "chi-rlto-140h-late-fee"
  kind: "prohibited_provision" | "missing_protection";
  title: string; // short UI title
  summary: string; // plain-English summary of the rule
  citation: string; // e.g. "Chicago Mun. Code § 5-12-140(h)"
  official_text: string; // verbatim text of the provision we rely on
  what_to_look_for: string; // guidance for the analyzer (prompt material)
  deterministic_check?: "late_fee_cap" | "early_payment_discount_cap";
  source_url: string;
  verified_against: string; // what document the text was checked against
  date_verified: string; // ISO date
  verified_by: string;
  status: "verified_official_publication" | "needs_human_verification";
}

export interface RulePack {
  id: string;
  name: string;
  jurisdiction: string;
  version: string;
  date_verified: string;
  caveats: string[]; // shown in UI + README
  remedies_context: { citation: string; summary: string; official_text: string }[];
  coverage: {
    citation: string;
    summary: string;
    exclusions: { id: string; summary: string }[];
  };
  rules: Rule[];
}

// ---------- Coverage (does the rule pack apply?) ----------

export type YesNoUnsure = "yes" | "no" | "unsure";

export interface CoverageAnswers {
  in_chicago: YesNoUnsure;
  /** Owner lives in the building AND it has 6 or fewer units (§5-12-020(a) exclusion). */
  owner_occupied_six_or_fewer: YesNoUnsure;
  /** Hotel/motel/dorm/co-op/employee housing/etc. (other §5-12-020 exclusions). */
  other_exclusion: YesNoUnsure;
}

export interface Coverage {
  answers: CoverageAnswers;
  rule_pack_applies: boolean;
  /** true when applies but some answer was "unsure" -> UI shows caveat. */
  uncertain: boolean;
  reason: string; // plain-English explanation shown in UI
}

// ---------- LLM raw output (validated with zod in lib/schemas.ts) ----------

export type LateFeeBasis = "flat_per_occurrence" | "per_day" | "percent_of_rent" | "other";

/** Numbers the model reads off a late-fee / early-payment clause. Code, not the model, decides the cap. */
export interface LateFeeExtraction {
  basis: LateFeeBasis;
  amount: number | null; // dollars (flat/per_day) or percent (percent_of_rent)
  initial_flat_amount: number | null; // e.g. "$50 plus $10/day" -> 50
  max_days: number | null; // per_day cap if stated
  monthly_rent_in_clause: number | null; // if the clause itself states rent
}

export interface RawClauseFinding {
  clause_id: string;
  quote: string; // must be an exact substring of the clause text
  plain_english: string;
  label: RiskLabel;
  rule_id: string | null;
  reasoning: string;
  suggested_message: string | null; // required for red/yellow, null for standard
  late_fee: LateFeeExtraction | null; // only for late-fee or early-payment-discount clauses
}

// ---------- Verified output ----------

export interface LateFeeCheck {
  monthly_rent: number | null;
  rent_source: "user" | "lease_text" | null;
  worst_case_monthly_fee: number | null;
  cap: number | null;
  over_cap: boolean | null; // null = not enough data to decide
  explanation: string; // shows the arithmetic in plain English
}

export interface ClauseFinding {
  clause_id: string;
  quote: string; // as it appears in sourceText (exact slice)
  quote_start: number; // offsets into sourceText
  quote_end: number;
  plain_english: string;
  label: RiskLabel;
  rule_id: string | null; // non-null only when label === "likely_unenforceable"
  reasoning: string;
  suggested_message: string | null;
  late_fee_check: LateFeeCheck | null;
  verification: {
    quote_match: "exact" | "whitespace_normalized";
    /** Set when the verifier changed the model's label. */
    label_adjusted: { from: RiskLabel; reason: string } | null;
  };
}

export interface RejectedFinding {
  clause_id: string;
  quote: string;
  reason: "quote_not_found" | "unknown_clause_id" | "duplicate" | "schema_invalid";
}

export interface VerificationStats {
  findings_received: number;
  findings_accepted: number;
  quotes_rejected: number;
  rule_citations_downgraded: number;
  rejected: RejectedFinding[];
}

export interface MissingProtection {
  rule_id: string;
  title: string;
  status: "not_found" | "found";
  explanation: string; // plain-English; "we could not find X" (never claims certainty)
  what_to_ask: string; // suggested request to the landlord
}

export interface ProviderInfo {
  name: "anthropic" | "openai-compatible" | "mock";
  model: string;
  is_mock: boolean;
}

export interface AnalysisResult {
  version: 1;
  generated_at: string;
  source_kind: "pdf" | "text";
  source_text: string;
  clauses: Clause[];
  findings: ClauseFinding[]; // at most one per clause; clauses without a finding render as unanalyzed
  missing: MissingProtection[];
  summary: string; // <= 3 sentences, only about flagged clauses
  questions_to_ask: string[];
  coverage: Coverage;
  stats: VerificationStats;
  provider: ProviderInfo;
  rule_pack: { id: string; name: string; version: string; date_verified: string; caveats: string[] };
  warnings: string[]; // e.g. "3 clauses could not be analyzed"
}

// ---------- API ----------

/** POST /api/analyze accepts multipart/form-data with these fields:
 *  - file: PDF (optional)  OR  text: string (optional) — exactly one required
 *  - coverage: JSON string of CoverageAnswers
 *  - monthly_rent: optional numeric string (user-entered; overrides lease text)
 *  Returns AnalysisResult (200) or ApiError (4xx/5xx). */
export interface ApiError {
  error: string; // user-facing message
  code: "bad_request" | "pdf_no_text" | "too_long" | "llm_unavailable" | "internal";
}

export const MAX_SOURCE_CHARS = 120_000;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
