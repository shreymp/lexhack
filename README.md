# Before You Sign

**A lease checker for Chicago renters. It only calls a clause "likely unenforceable" when it can point to the law that says so.**

Upload or paste a residential lease and you get:

- a plain-English explanation of every clause
- risky clauses highlighted in the original text, riskiest first
- a check for protections the lease is **missing**
- a short, polite message to send the landlord about each problem, plus questions to ask before signing
- a legal-aid link and a disclaimer on every results page

Built for **LexHack 2026**, Access to Justice & Civic Tech track.

> ⚠️ **Not legal advice.** This tool explains documents and points to published law. It can make mistakes and does not replace a lawyer. See [Limitations](#limitations).

---

## Why you can trust the output

| Guardrail | What it does | Where |
|---|---|---|
| **Cite or abstain** | A clause can be labeled *Likely unenforceable* only if it cites a rule in the Chicago rule pack. Anything else is at most *One-sided or unusual*. Citations to unknown rules are downgraded automatically. | `lib/verify.ts`, `rules/chicago-rlto.json` |
| **Verbatim quotes** | Every flagged clause carries a quote that must appear in your lease. The quote is found exactly, or with only whitespace and quote-mark differences, and mapped back to exact character offsets. If it can't be found, the finding is thrown out before it reaches the screen. | `lib/verify.ts` |
| **The code checks the math** | For late fees, the AI only reads the numbers off the clause. Code computes the Chicago cap and decides whether the fee is over it, and the arithmetic is shown to the user. | `lib/latefee.ts` |
| **Coverage check** | The renter answers three questions. If the RLTO may not cover the unit (§ 5-12-020), the rule pack is turned off and nothing is labeled unenforceable. | `lib/coverage.ts` |
| **Never says "illegal"** | Labels read "Likely unenforceable under [citation]". The verifier rewrites the word if a model uses it, and an end-to-end test checks it never appears on the page. | `lib/verify.ts`, `tests/e2e` |
| **Missing protections** | Deterministic checks look for things the lease should contain, such as the City's RLTO summary and where the security deposit is held. | `lib/missing.ts` |

## How it works

```
PDF / pasted text
 → extract text (unpdf)                       lib/extract.ts
 → normalize + split into clauses w/ offsets  lib/text.ts, lib/segment.ts
 → coverage questions → rule pack on/off      lib/coverage.ts
 → LLM labels clauses in batches of 12        lib/analyze.ts, lib/prompts/analyze.v1.ts
 → verify quotes, citations, late-fee cap     lib/verify.ts, lib/latefee.ts
 → missing-protection checks                  lib/missing.ts
 → 3-sentence summary + questions to ask      lib/summarize.ts
 → highlighted document + findings UI         app/results/page.tsx, components/
```

The pipeline is orchestrated in `lib/pipeline.ts` and served by `app/api/analyze/route.ts`. Nothing is stored. The lease is processed in memory, and the result is kept only in the browser tab's `sessionStorage`.

## Chicago rule pack

`rules/chicago-rlto.json` has 11 prohibited-provision rules and 2 missing-protection checks from the Chicago Residential Landlord and Tenant Ordinance (Municipal Code ch. 5-12):

- **Prohibited provisions (§ 5-12-140):**
  - (a) waiver of RLTO rights
  - (b) confession of judgment
  - (c) limiting legal liability
  - (d) waiving termination notices
  - (e) jury waiver
  - (f) tenant pays the landlord's attorney's fees
  - (g) unequal termination rights
  - (h) late fee over the cap
  - (i) oversized early-payment discount
- **Specific rights waived via § 5-12-140(a):** 2 days' notice before entry (§ 5-12-050), and deposit return within 45 days without deductions for normal wear and tear (§ 5-12-080(d)).
- **Missing protections:** RLTO summary attached (§ 5-12-170), and the name and address of the bank holding the deposit (§ 5-12-080(a)(3)).

Each rule stores its citation, the **official text quoted verbatim**, the source URL, what it was checked against, the date checked, who checked it, and a status.

**Verification status. Please read this.** The rule text was checked against the City of Chicago's *Residential Landlord and Tenant Guide* (City Clerk publication, "Last book update on August 25, 2021"). The live official code at codelibrary.amlegal.com could not be reached from the build environment. Later amendments may have changed wording or subsection letters. The rules were pulled out by an AI coding assistant, so every rule is marked `needs_human_verification` until someone with legal training checks it against the current code.

## Running it

Requirements: Node 20+.

```bash
npm install
cp .env.example .env.local   # then fill in one provider (see below); never commit keys
npm run dev                  # http://localhost:3000
```

### Choosing the LLM

| `LLM_PROVIDER` | Needs | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | Uses the official Anthropic SDK with a forced tool call for structured JSON. `LLM_MODEL` defaults to the value in `lib/llm/index.ts`. |
| `openai-compatible` | `OPENAI_COMPAT_API_KEY`, `LLM_MODEL` | Plain `fetch` to `OPENAI_COMPAT_BASE_URL` (defaults to OpenRouter, `https://openrouter.ai/api/v1`; OpenAI also works). Asks for `json_schema` output and falls back to `json_object`. Use a model id from your provider's model list. |
| `mock` | nothing | Offline keyword heuristics for demos and tests. Clearly labeled "Demo mode" in the UI. **Not an accuracy measure.** |

If `LLM_PROVIDER` is unset, the app picks `anthropic` when that key is set, then `openai-compatible`, then `mock`.

### Checks

```bash
npm run typecheck && npm run lint && npm test   # unit tests (vitest)
npm run test:e2e                                # Playwright: builds, starts the app with the mock provider, runs the core loop
npm run eval                                    # trap-lease evaluation (see below)
```

## Evaluation

`eval/` contains a synthetic **trap lease** (37 clauses, fictional parties) with known planted problems:

- 10 that should be *likely unenforceable*, each tied to a rule
- 4 *one-sided* clauses
- 23 normal clauses, including tricky ones: an early-payment discount under the cap, and emergency entry with notice afterward
- 2 missing protections

There is also a **held-out lease** written by a separate agent that never saw the detection logic. `npm run eval` reports what was caught, what was missed, false alarms, and how many quotes and citations the verifier rejected or downgraded. See `eval/README.md`.

**Results so far:**

- **Real LLM: not yet measured.** The build environment had no network access to an LLM provider. Run `npm run eval` with a provider configured and record the numbers here. Only measured numbers should be reported.
- **Mock provider:** its keyword patterns were tuned while looking at the trap lease, so its perfect score there says nothing about real accuracy. On the held-out lease it caught 4 of 6 planted red flags and 0 of 3 one-sided clauses, with no false alarms on the 21 standard clauses. It exists so the pipeline, verifier and UI can be tested offline.

## Privacy

- The lease text **is sent to the configured LLM provider** for analysis.
- The app itself stores nothing: there is no database, and the lease text is not logged.
- The trap leases are synthetic, so no real person's information is in the repo or the demo.

## Limitations

- Not legal advice. Labels are "likely," not verdicts.
- One jurisdiction (City of Chicago) and a small set of rules. **A clean result does not mean a lease is fair or lawful.**
- The RLTO doesn't cover every Chicago rental. The coverage questions depend on the renter's answers.
- The model can still misread a clause. Quote verification catches invented text, not every wrong interpretation.
- Laws change. Rule text was checked against a 2021 City publication and needs review against the current code (see above).
- Scanned or photographed leases (no text layer) aren't supported yet. The app asks the user to paste the text instead.

## AI tools & libraries disclosure (required by LexHack)

- **Runtime LLM:** set by environment variable. Supported: Anthropic Claude via the Anthropic API, or any OpenAI-compatible endpoint such as OpenRouter. *The team should record the exact provider and model used for the demo and eval here.*
- **AI coding assistants used in development:** Claude Code (Anthropic), with parallel sub-agents that wrote code under a lead agent's review. *The team should add any others it used.*
- **Libraries (runtime):** next 15.5, react 19.1, react-dom 19.1, zod 4, @anthropic-ai/sdk, unpdf.
- **Libraries (development):** typescript, eslint + eslint-config-next, vitest, @playwright/test, tsx, pdf-lib (generates the trap-lease PDF), @types/*.

## Project layout

```
app/                 Next.js pages + /api/analyze route
components/          UI components (labels.ts = single source for label names/icons)
lib/                 pipeline modules, LLM providers (lib/llm), prompts (lib/prompts)
rules/               jurisdiction rule pack
eval/                trap lease, held-out lease, labels, scorer, runner
tests/unit, tests/e2e
```
