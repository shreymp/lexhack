#!/usr/bin/env -S npx tsx
// CLI harness: runs the full pipeline against eval/trap-lease.txt, scores it against
// eval/labels.json, prints a report, and writes eval/results/<provider>-<model>.json.
//
// Usage:
//   npm run eval                      # LLM_PROVIDER from env (mock by default -- see lib/llm/index.ts)
//   npm run eval -- --runs 5          # repeat 5x, report mean/min/max (for LLM variance)
//   npm run eval -- --rent-from-lease # pass monthlyRent: null (let the pipeline read rent off the lease text)
//
// Exit code is always 0 -- this is a report, not a pass/fail gate.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAnalysis } from "@/lib/pipeline";
import type { AnalysisResult } from "@/lib/types";
import { scoreResult, renderRowsTable, type Labels, type EvalReport } from "./score";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]) {
  let runs = 1;
  let rentFromLease = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--runs") {
      const n = Number(argv[i + 1]);
      if (!Number.isFinite(n) || n < 1) {
        console.error(`Invalid --runs value: ${argv[i + 1]}`);
        process.exit(0);
      }
      runs = n;
      i++;
    } else if (argv[i] === "--rent-from-lease") {
      rentFromLease = true;
    }
  }
  return { runs, rentFromLease };
}

function mean(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function summarizeNumeric(values: number[]): { mean: number; min: number; max: number } {
  return { mean: Math.round(mean(values) * 100) / 100, min: Math.min(...values), max: Math.max(...values) };
}

/** Every numeric field of EvalReport we want mean/min/max for across repeated runs. */
const NUMERIC_FIELDS = [
  "red_planted",
  "red_caught_exact",
  "red_caught_other_rule",
  "red_flagged_yellow_only",
  "red_missed",
  "yellow_planted",
  "yellow_caught",
  "yellow_missed",
  "standard_total",
  "false_alarms_red",
  "false_alarms_yellow",
  "missing_expected",
  "missing_correct",
  "unanalyzed_clauses",
  "unmatched_labels",
] as const;

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function main() {
  const { runs, rentFromLease } = parseArgs(process.argv.slice(2));

  const leaseText = readFileSync(join(__dirname, "trap-lease.txt"), "utf8");
  const labels: Labels = JSON.parse(readFileSync(join(__dirname, "labels.json"), "utf8"));

  const coverage = { in_chicago: "yes" as const, owner_occupied_six_or_fewer: "no" as const, other_exclusion: "no" as const };
  const monthlyRent = rentFromLease ? null : labels.monthly_rent;

  const reports: EvalReport[] = [];
  let lastResult: AnalysisResult | null = null;

  for (let i = 0; i < runs; i++) {
    if (runs > 1) console.log(`\n=== Run ${i + 1}/${runs} ===`);
    const result = await runAnalysis({
      sourceText: leaseText,
      sourceKind: "text",
      coverage,
      monthlyRent,
    });
    lastResult = result;
    reports.push(scoreResult(result, labels));
  }

  if (!lastResult) {
    console.error("No runs completed.");
    process.exit(0);
  }

  const provider = lastResult.provider;
  console.log("\n================ Before You Sign -- Eval Report ================");
  console.log(`Provider: ${provider.name}   Model: ${provider.model}   is_mock: ${provider.is_mock}`);
  if (provider.is_mock) {
    console.log("MOCK PROVIDER -- these numbers measure the keyword heuristics, NOT the AI model.");
  }
  console.log(`Lease: eval/${labels.lease}   Monthly rent used: ${monthlyRent ?? "(read from lease text by pipeline)"}`);
  console.log(`Runs: ${runs}`);
  console.log("==================================================================\n");

  if (runs === 1) {
    printSingleReport(reports[0]);
  } else {
    printAggregateReport(reports);
  }

  // Always print the per-clause table for the most recent run.
  console.log("\n--- Per-clause table (most recent run) ---");
  console.log(renderRowsTable(reports[reports.length - 1].rows));

  // Write results file.
  const resultsDir = join(__dirname, "results");
  mkdirSync(resultsDir, { recursive: true });
  const fileName = `${sanitize(provider.name)}-${sanitize(provider.model)}.json`;
  const outPath = join(resultsDir, fileName);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        provider,
        lease: labels.lease,
        monthly_rent_used: monthlyRent,
        runs,
        reports,
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${outPath}`);

  process.exit(0);
}

function printSingleReport(r: EvalReport) {
  console.log(`RED   planted=${r.red_planted}  exact=${r.red_caught_exact}  other_rule=${r.red_caught_other_rule}  ` +
    `flagged_yellow_only=${r.red_flagged_yellow_only}  missed=${r.red_missed}`);
  console.log(`YELLOW planted=${r.yellow_planted}  caught=${r.yellow_caught}  missed=${r.yellow_missed}`);
  console.log(`STANDARD total=${r.standard_total}  false_alarms_red=${r.false_alarms_red}  false_alarms_yellow=${r.false_alarms_yellow}`);
  console.log(`MISSING expected=${r.missing_expected}  correct=${r.missing_correct}`);
  for (const m of r.missing_rows) {
    console.log(`  - ${m.rule_id}: expected=${m.expected_status} got=${m.got_status ?? "(absent from result.missing)"} ${m.correct ? "OK" : "WRONG"}`);
  }
  console.log(`VERIFIER findings_received=${r.verifier.findings_received}  findings_accepted=${r.verifier.findings_accepted}  ` +
    `quotes_rejected=${r.verifier.quotes_rejected}  rule_citations_downgraded=${r.verifier.rule_citations_downgraded}`);
  console.log(`UNANALYZED clauses=${r.unanalyzed_clauses}   UNMATCHED labels (fixture bug if >0)=${r.unmatched_labels}`);
}

function printAggregateReport(reports: EvalReport[]) {
  console.log(`Aggregated over ${reports.length} runs (mean / min / max):\n`);
  for (const field of NUMERIC_FIELDS) {
    const values = reports.map((r) => r[field] as number);
    const { mean: m, min, max } = summarizeNumeric(values);
    console.log(`${field.padEnd(26)} ${m} / ${min} / ${max}`);
  }
  const verifierFields = ["findings_received", "findings_accepted", "quotes_rejected", "rule_citations_downgraded"] as const;
  console.log("\nVerifier stats (mean / min / max):");
  for (const field of verifierFields) {
    const values = reports.map((r) => r.verifier[field]);
    const { mean: m, min, max } = summarizeNumeric(values);
    console.log(`${field.padEnd(26)} ${m} / ${min} / ${max}`);
  }
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exit(0);
});
