# Eval: trap lease + scoring harness

This directory measures how well the pipeline (segmentation + LLM analysis +
verification + missing-protection checks) does at flagging planted problems in
a synthetic Chicago lease. **Only the numbers this harness actually prints may
be reported as results** -- don't paraphrase them into a different claim (e.g.
"the model caught everything") without checking the specific counters below.

## Files

- `trap-lease.txt` -- a synthetic, fictional Chicago apartment lease (~37
  numbered clauses) with planted problems: RED clauses that map to a specific
  Chicago RLTO rule (`rule_id`), YELLOW clauses that are one-sided but don't
  map to a specific rule, a couple of TRICKY-STANDARD clauses designed to look
  risky but that should NOT be flagged, and two protections that are
  deliberately missing from the whole document (no RLTO summary reference, no
  bank named for the security deposit).
- `trap-lease.pdf` -- the same lease rendered as a PDF (Letter, 11pt
  Helvetica, word-wrapped, 1-inch margins), for exercising the PDF-extraction
  path. Regenerate with `npm run make:trap-pdf`.
- `labels.json` -- ground truth. Each clause label is keyed by a `match`
  string: a unique substring of the lease text, not a clause number, so the
  labels survive re-segmentation. `tests/unit/eval-score.test.ts` asserts every
  `match` occurs exactly once in the lease.
- `score.ts` -- pure function `scoreResult(result, labels): EvalReport`. No
  I/O, no network calls; safe to unit test directly.
- `run.ts` -- the CLI. Reads the trap lease + labels, calls
  `runAnalysis(...)` from `lib/pipeline.ts` (provider chosen via
  `LLM_PROVIDER`/`getProvider()`, same as the app), scores the result, prints
  a report, and writes `eval/results/<provider>-<model>.json`.
- `make-pdf.ts` -- generates `trap-lease.pdf` from `trap-lease.txt` using
  `pdf-lib`.

## Running

```bash
npm run eval                       # uses LLM_PROVIDER from your env/.env.local (mock by default)
npm run eval -- --runs 5           # repeat 5x and report mean/min/max (LLM variance)
npm run eval -- --rent-from-lease  # pass monthlyRent: null, forcing the pipeline to read rent off the lease text
npm run make:trap-pdf               # regenerate eval/trap-lease.pdf after editing trap-lease.txt
```

The eval always exits 0 -- it's a report, not a CI gate. If the provider is
mock, the report prints **"MOCK PROVIDER -- these numbers measure the keyword
heuristics, NOT the AI model."** in bold at the top; don't drop that caveat
when relaying results.

## What each metric means

All counts are per labeled clause unless noted.

- **red_planted** -- number of clauses labeled `likely_unenforceable` in
  `labels.json` (10 in the trap lease, one per required RLTO prohibited-provision
  rule).
- **red_caught_exact** -- planted red clause the pipeline also labeled
  `likely_unenforceable` **with the same `rule_id`**. This is the number that
  matters most: a right label with the wrong citation is still a citation bug.
- **red_caught_other_rule** -- labeled `likely_unenforceable` but cited a
  different `rule_id` than the label expects (a real citation mistake).
- **red_flagged_yellow_only** -- the pipeline (or the verifier, which can
  downgrade an unverifiable red claim) called it `one_sided` instead of
  `likely_unenforceable`. Better than a full miss, still a miss for grading
  purposes on the "caught the RLTO violation" question.
- **red_missed** -- labeled `standard`, or no finding at all for that clause.
- **yellow_planted / yellow_caught / yellow_missed** -- yellow (`one_sided`,
  no rule) clauses; caught means the pipeline flagged it as either
  `one_sided` or `likely_unenforceable` (over-flagging a yellow as red is not
  penalized here -- it's a stricter read, not a miss).
- **standard_total / false_alarms_red / false_alarms_yellow** -- clauses
  labeled `standard` (including the tricky-standard ones: the within-cap early
  payment discount and the properly-noticed emergency-entry clause). A false
  alarm means the pipeline flagged a genuinely standard clause as red or
  yellow. This is the harness's main defense against a model or heuristic that
  over-flags to look thorough.
- **missing_expected / missing_correct / missing_rows** -- the two protections
  the trap lease deliberately omits (`chi-rlto-170-summary`,
  `chi-rlto-080a3-deposit-bank`). Both should come back `status: "not_found"`
  in `result.missing`.
- **verifier.\*** -- passthrough of `result.stats`: how many raw findings the
  LLM produced, how many survived verification, how many were rejected for a
  quote that wasn't found verbatim in the lease, and how many
  `likely_unenforceable` labels were downgraded for lacking a valid citation.
  High `quotes_rejected` or `rule_citations_downgraded` numbers point at a
  prompt or verifier bug even when the top-line red/yellow counts look fine.
- **unanalyzed_clauses** -- clauses in the document with no finding at all
  (separate from clauses correctly labeled `standard`).
- **unmatched_labels** -- a `labels.json` entry whose `match` string could not
  be located inside any clause of the *analyzed* document. This should always
  be 0; a nonzero value means the fixture or the segmenter changed underfoot,
  not that the model did anything wrong.

Each clause also gets a row in the printed per-clause table (excerpt,
expected, got, whether the rule_id matched, and a category label) so you can
find a specific miss instead of only seeing aggregate counts.

## `--runs N` and LLM variance

Real LLM providers are non-deterministic. `--runs N` repeats the full pipeline
run N times against the same lease and reports mean/min/max for every numeric
metric (including the verifier stats), so a single unlucky run doesn't get
over-interpreted. With the mock provider all runs are identical, since the
mock is a deterministic keyword heuristic.

## Note on `tsx` and the `@/` alias

`eval/run.ts` and `eval/make-pdf.ts` use the `@/` import alias (e.g.
`@/lib/pipeline`), which resolves via `tsconfig.json`'s `paths`. This was
verified directly: `npx tsx` picks up `tsconfig.json` `paths` when run from
the repo root, so no relative-import workaround was needed.
