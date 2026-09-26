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
- `holdout-lease.txt` / `holdout-labels.json` -- a second, held-out lease +
  labels pair. See "Held-out lease" below.

## Running

```bash
npm run eval                                       # uses LLM_PROVIDER from your env/.env.local (mock by default)
npm run eval -- --runs 5                           # repeat 5x and report mean/min/max (LLM variance)
npm run eval -- --rent-from-lease                  # pass monthlyRent: null, forcing the pipeline to read rent off the lease text
npm run eval -- --labels eval/holdout-labels.json  # score the held-out lease instead of the trap lease
npm run make:trap-pdf                               # regenerate eval/trap-lease.pdf after editing trap-lease.txt
```

`--labels <path>` picks which labels file (and therefore which lease) to
score: it defaults to `eval/labels.json`, and the lease file it loads is
whatever that labels file's `"lease"` field names, resolved relative to the
labels file's own directory -- so `eval/holdout-labels.json`'s `"lease":
"holdout-lease.txt"` resolves to `eval/holdout-lease.txt` with no extra flag
needed. The results file written to `eval/results/` now includes the lease
name, e.g. `mock-keyword-heuristics-v1-holdout-lease.json` (versus
`mock-keyword-heuristics-v1-trap-lease.json` for the default run), so runs
against different leases don't overwrite each other.

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
- **standard_total / standard_correct / standard_unanalyzed / false_alarms_red /
  false_alarms_yellow** -- clauses labeled `standard` (including the
  tricky-standard ones: the within-cap early payment discount and the
  properly-noticed emergency-entry clause). `standard_correct` requires an
  actual finding whose label is `standard` -- a clause the pipeline never
  produced a finding for is **not** counted as correct. Those go into
  `standard_unanalyzed` instead: a clause with no finding at all is neither a
  correct catch nor a false alarm, since there's nothing to judge. A false
  alarm (`false_alarms_red` / `false_alarms_yellow`) means the pipeline
  flagged a genuinely standard clause as red or yellow. These four numbers
  always sum to `standard_total`. This is the harness's main defense against
  a model or heuristic that over-flags to look thorough, or that quietly
  skips clauses to avoid false alarms.
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
expected, got, `rule_ok`, and a category label) so you can find a specific
miss instead of only seeing aggregate counts. `rule_ok` is `yes`/`no` when the
clause has a finding, and `n/a` when it has none at all -- a clause with no
finding can't be judged right or wrong, so it's never silently counted as
"ok".

## `--runs N` and LLM variance

Real LLM providers are non-deterministic. `--runs N` repeats the full pipeline
run N times against the same lease and reports mean/min/max for every numeric
metric (including the verifier stats), so a single unlucky run doesn't get
over-interpreted. With the mock provider all runs are identical, since the
mock is a deterministic keyword heuristic.

## Held-out lease

`trap-lease.txt` was built alongside the detection logic, so a good score on
it partly measures whether the prompts and mock heuristics were tuned to its
exact wording. `holdout-lease.txt` + `holdout-labels.json` exist to check
that separately: the holdout lease was written by reading only this
directory's schema files (`rules/chicago-rlto.json`, `lib/types.ts`,
`eval/score.ts`, `eval/run.ts`, this README) -- **without** opening
`lib/llm/mock.ts` or anything under `lib/prompts/`, and without looking at
`trap-lease.txt` or `labels.json`. The goal was a lease that plants the same
kinds of problems using different structure and wording than the trap lease,
so a pipeline that only pattern-matches the trap lease's phrasing will show
it on this fixture instead of on the one it was tuned against.

Differences from the trap lease, by design:

- Numbered "Section N -- Title" headings instead of the trap lease's plain
  numbered-clause style, "Lessor/Lessee" instead of "Landlord/Tenant", and
  more passive, legalese phrasing throughout.
- 30 sections, one labeled clause each: 6 RED clauses (each a different
  `rule_id` from `rules/chicago-rlto.json`, including the late-fee rule
  stated as a per-day charge -- $15/day for up to 30 days on $2,100 rent is a
  $450 worst case against a $90 cap, so it is over the cap however the
  worst-case fee is computed), 3 YELLOW one-sided-but-no-rule clauses
  (landlord may amend house rules unilaterally at any time, mandatory
  professional carpet cleaning at move-out regardless of condition, tenant
  pays for all pest control regardless of cause), 3 TRICKY-STANDARD clauses
  that read as risky but are fine under the rule text (a 48-hour entry-notice
  clause, which satisfies the RLTO's 2-day minimum; a mutual court-costs
  clause expressly limited to "as provided by law"; and a $25/month
  early-payment discount, which is within the same cap formula as the late
  fee), and 18 ordinary standard clauses.
- The RLTO summary reference and a named deposit bank + street address are
  both present (Sections 29 and 5), so both missing-protection checks
  (`chi-rlto-170-summary`, `chi-rlto-080a3-deposit-bank`) should come back
  `"found"` -- the opposite of the trap lease, which omits both.

Run it with:

```bash
npm run eval -- --labels eval/holdout-labels.json
```

A weak mock-provider score on the holdout lease is expected and is the point
-- the mock is a keyword heuristic built around the trap lease's wording, not
a general Chicago-lease detector. `tests/unit/eval-holdout.test.ts` checks
the fixture itself (every `match` is a unique substring of the holdout lease,
and every expected red `rule_id` exists in the rule pack) rather than
grading the pipeline's output, since a weak score here is not a bug.

## Note on `tsx` and the `@/` alias

`eval/run.ts` and `eval/make-pdf.ts` use the `@/` import alias (e.g.
`@/lib/pipeline`), which resolves via `tsconfig.json`'s `paths`. This was
verified directly: `npx tsx` picks up `tsconfig.json` `paths` when run from
the repo root, so no relative-import workaround was needed.
