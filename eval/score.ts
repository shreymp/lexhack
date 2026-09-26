// Pure, unit-testable scorer for eval runs against the trap lease (or any labeled lease).
// No I/O here -- run.ts does the file reading / provider calls and prints the report.
import type { AnalysisResult, ClauseFinding, Clause, RiskLabel } from "../lib/types";

export interface LabelClause {
  match: string; // unique substring of the (normalized) lease text
  expected: RiskLabel;
  rule_id: string | null;
  note: string;
}

export interface LabelMissing {
  rule_id: string;
  expected_status: "not_found" | "found";
}

export interface Labels {
  lease: string;
  monthly_rent: number;
  clauses: LabelClause[];
  missing: LabelMissing[];
}

export interface ClauseRow {
  match: string;
  expected: RiskLabel;
  expected_rule_id: string | null;
  clause_id: string | null; // null if the match couldn't be located in any clause
  got_label: RiskLabel | "unanalyzed" | "unmatched";
  got_rule_id: string | null;
  rule_ok: boolean; // true when label matches AND (not likely_unenforceable OR rule_id matches)
  category:
    | "red_caught_exact"
    | "red_caught_other_rule"
    | "red_flagged_yellow_only"
    | "red_missed"
    | "yellow_caught"
    | "yellow_missed"
    | "standard_false_alarm_red"
    | "standard_false_alarm_yellow"
    | "standard_ok"
    | "unmatched";
}

export interface EvalReport {
  red_planted: number;
  red_caught_exact: number;
  red_caught_other_rule: number;
  red_flagged_yellow_only: number;
  red_missed: number;

  yellow_planted: number;
  yellow_caught: number;
  yellow_missed: number;

  standard_total: number;
  false_alarms_red: number; // standard clause flagged likely_unenforceable
  false_alarms_yellow: number; // standard clause flagged one_sided

  missing_expected: number;
  missing_correct: number;
  missing_rows: { rule_id: string; expected_status: string; got_status: string | null; correct: boolean }[];

  verifier: {
    findings_received: number;
    findings_accepted: number;
    quotes_rejected: number;
    rule_citations_downgraded: number;
  };

  unanalyzed_clauses: number;
  unmatched_labels: number; // label "match" strings that could not be located in any clause -- a bug in the eval fixture, not the pipeline

  rows: ClauseRow[];
}

/** Finds which clause (if any) contains the given substring, using clause offsets. */
function findClauseForMatch(match: string, sourceText: string, clauses: Clause[]): Clause | null {
  const idx = sourceText.indexOf(match);
  if (idx === -1) return null;
  const end = idx + match.length;
  return clauses.find((c) => idx >= c.start && end <= c.end) ?? null;
}

export function scoreResult(result: AnalysisResult, labels: Labels): EvalReport {
  const findingByClauseId = new Map<string, ClauseFinding>();
  for (const f of result.findings) findingByClauseId.set(f.clause_id, f);

  const rows: ClauseRow[] = [];

  let red_planted = 0;
  let red_caught_exact = 0;
  let red_caught_other_rule = 0;
  let red_flagged_yellow_only = 0;
  let red_missed = 0;
  let yellow_planted = 0;
  let yellow_caught = 0;
  let yellow_missed = 0;
  let standard_total = 0;
  let false_alarms_red = 0;
  let false_alarms_yellow = 0;
  let unmatched_labels = 0;

  for (const label of labels.clauses) {
    const clause = findClauseForMatch(label.match, result.source_text, result.clauses);
    if (!clause) {
      unmatched_labels++;
      rows.push({
        match: label.match,
        expected: label.expected,
        expected_rule_id: label.rule_id,
        clause_id: null,
        got_label: "unmatched",
        got_rule_id: null,
        rule_ok: false,
        category: "unmatched",
      });
      continue;
    }

    const finding = findingByClauseId.get(clause.id);
    const gotLabel: RiskLabel | "unanalyzed" = finding ? finding.label : "unanalyzed";
    const gotRuleId = finding?.rule_id ?? null;

    let category: ClauseRow["category"];
    let ruleOk = false;

    if (label.expected === "likely_unenforceable") {
      red_planted++;
      if (gotLabel === "likely_unenforceable" && gotRuleId === label.rule_id) {
        red_caught_exact++;
        category = "red_caught_exact";
        ruleOk = true;
      } else if (gotLabel === "likely_unenforceable") {
        red_caught_other_rule++;
        category = "red_caught_other_rule";
      } else if (gotLabel === "one_sided") {
        red_flagged_yellow_only++;
        category = "red_flagged_yellow_only";
      } else {
        red_missed++;
        category = "red_missed";
      }
    } else if (label.expected === "one_sided") {
      yellow_planted++;
      if (gotLabel === "likely_unenforceable" || gotLabel === "one_sided") {
        yellow_caught++;
        category = "yellow_caught";
        ruleOk = true;
      } else {
        yellow_missed++;
        category = "yellow_missed";
      }
    } else {
      // expected === "standard"
      standard_total++;
      if (gotLabel === "likely_unenforceable") {
        false_alarms_red++;
        category = "standard_false_alarm_red";
      } else if (gotLabel === "one_sided") {
        false_alarms_yellow++;
        category = "standard_false_alarm_yellow";
      } else {
        category = "standard_ok";
        ruleOk = true;
      }
    }

    rows.push({
      match: label.match,
      expected: label.expected,
      expected_rule_id: label.rule_id,
      clause_id: clause.id,
      got_label: gotLabel,
      got_rule_id: gotRuleId,
      rule_ok: ruleOk,
      category,
    });
  }

  // Missing protections.
  const missingByRuleId = new Map(result.missing.map((m) => [m.rule_id, m]));
  const missing_rows = labels.missing.map((m) => {
    const got = missingByRuleId.get(m.rule_id);
    const got_status = got ? got.status : null;
    return { rule_id: m.rule_id, expected_status: m.expected_status, got_status, correct: got_status === m.expected_status };
  });
  const missing_expected = labels.missing.length;
  const missing_correct = missing_rows.filter((r) => r.correct).length;

  // Unanalyzed clauses: any clause in the document with no finding at all.
  const unanalyzed_clauses = result.clauses.filter((c) => !findingByClauseId.has(c.id)).length;

  return {
    red_planted,
    red_caught_exact,
    red_caught_other_rule,
    red_flagged_yellow_only,
    red_missed,
    yellow_planted,
    yellow_caught,
    yellow_missed,
    standard_total,
    false_alarms_red,
    false_alarms_yellow,
    missing_expected,
    missing_correct,
    missing_rows,
    verifier: {
      findings_received: result.stats.findings_received,
      findings_accepted: result.stats.findings_accepted,
      quotes_rejected: result.stats.quotes_rejected,
      rule_citations_downgraded: result.stats.rule_citations_downgraded,
    },
    unanalyzed_clauses,
    unmatched_labels,
    rows,
  };
}

/** Renders a short plain-text table of per-clause results, for the CLI report. */
export function renderRowsTable(rows: ClauseRow[]): string {
  const lines: string[] = [];
  const header = ["excerpt", "expected", "got", "rule_ok", "category"];
  lines.push(header.join(" | "));
  for (const r of rows) {
    const excerpt = r.match.length > 50 ? r.match.slice(0, 47) + "..." : r.match;
    const expected = r.expected_rule_id ? `${r.expected}(${r.expected_rule_id})` : r.expected;
    const got = r.got_rule_id ? `${r.got_label}(${r.got_rule_id})` : r.got_label;
    lines.push([excerpt, expected, got, r.rule_ok ? "yes" : "no", r.category].join(" | "));
  }
  return lines.join("\n");
}
