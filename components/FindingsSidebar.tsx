"use client";

import type { Clause, ClauseFinding, RiskLabel } from "@/lib/types";
import { labelInfo } from "@/components/labels";

const ORDER: RiskLabel[] = ["likely_unenforceable", "one_sided", "standard"];

interface FindingsSidebarProps {
  clauses: Clause[];
  findings: ClauseFinding[];
  selectedClauseId: string | null;
  onSelect: (clauseId: string) => void;
}

function excerpt(text: string, max = 100): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

export default function FindingsSidebar({ clauses, findings, selectedClauseId, onSelect }: FindingsSidebarProps) {
  const clauseById = new Map(clauses.map((c) => [c.id, c]));

  const byLabel: Record<RiskLabel, ClauseFinding[]> = {
    likely_unenforceable: [],
    one_sided: [],
    standard: [],
  };
  for (const f of findings) {
    byLabel[f.label]?.push(f);
  }
  for (const label of ORDER) {
    byLabel[label].sort((a, b) => {
      const ca = clauseById.get(a.clause_id)?.index ?? 0;
      const cb = clauseById.get(b.clause_id)?.index ?? 0;
      return ca - cb;
    });
  }

  function renderItem(finding: ClauseFinding) {
    const clause = clauseById.get(finding.clause_id);
    const info = labelInfo(finding.label);
    const heading = clause?.heading ?? (clause ? `Clause ${clause.index + 1}` : finding.clause_id);
    return (
      <li key={finding.clause_id}>
        <button
          type="button"
          className="finding-item"
          aria-pressed={selectedClauseId === finding.clause_id}
          onClick={() => onSelect(finding.clause_id)}
        >
          <span className={`chip chip--${info.key}`}>
            <span className="chip-icon" aria-hidden="true">
              {info.icon}
            </span>
            {info.name}
          </span>
          <span className="finding-item__heading">{heading}</span>
          <span className="finding-item__excerpt">{excerpt(finding.plain_english)}</span>
        </button>
      </li>
    );
  }

  return (
    <div>
      <h2 className="section-title">Findings</h2>
      {byLabel.likely_unenforceable.length > 0 && (
        <ul className="finding-list" style={{ marginBottom: 12 }}>
          {byLabel.likely_unenforceable.map(renderItem)}
        </ul>
      )}
      {byLabel.one_sided.length > 0 && (
        <ul className="finding-list" style={{ marginBottom: 12 }}>
          {byLabel.one_sided.map(renderItem)}
        </ul>
      )}
      {byLabel.standard.length > 0 && (
        <details className="standard-details">
          <summary>Standard clauses ({byLabel.standard.length})</summary>
          <ul className="finding-list">{byLabel.standard.map(renderItem)}</ul>
        </details>
      )}
      {findings.length === 0 && <p className="helper-text">No clauses were flagged.</p>}
    </div>
  );
}
