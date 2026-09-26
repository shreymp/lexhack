"use client";

import { useEffect, useRef, useState } from "react";
import type { Clause, ClauseFinding, RiskLabel } from "@/lib/types";
import { labelInfo } from "@/components/labels";
import DetailPanel from "@/components/DetailPanel";

const ORDER: RiskLabel[] = ["likely_unenforceable", "one_sided", "standard"];

interface FindingsSidebarProps {
  clauses: Clause[];
  findings: ClauseFinding[];
  /** Currently expanded/selected clause id (shared with the document view). */
  selectedClauseId: string | null;
  /** Called when a finding card is clicked directly (toggles expansion). */
  onToggle: (clauseId: string) => void;
}

function excerpt(text: string, max = 100): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

export default function FindingsSidebar({ clauses, findings, selectedClauseId, onToggle }: FindingsSidebarProps) {
  const clauseById = new Map(clauses.map((c) => [c.id, c]));
  const containerRef = useRef<HTMLDivElement>(null);
  const [standardOpen, setStandardOpen] = useState(false);

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

  const selectedIsStandard = Boolean(
    selectedClauseId && byLabel.standard.some((f) => f.clause_id === selectedClauseId),
  );

  // Auto-open the "Standard clauses" details when a standard clause is selected
  // from the document, and scroll the expanded card into view either way.
  useEffect(() => {
    if (selectedIsStandard) setStandardOpen(true);
  }, [selectedIsStandard]);

  useEffect(() => {
    if (!selectedClauseId || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-finding-id="${CSS.escape(selectedClauseId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedClauseId]);

  function renderItem(finding: ClauseFinding) {
    const clause = clauseById.get(finding.clause_id) ?? null;
    const info = labelInfo(finding.label);
    const heading = clause?.heading ?? (clause ? `Clause ${clause.index + 1}` : finding.clause_id);
    const isOpen = selectedClauseId === finding.clause_id;
    return (
      <li key={finding.clause_id} data-finding-id={finding.clause_id}>
        <button
          type="button"
          className="finding-item"
          aria-expanded={isOpen}
          onClick={() => onToggle(finding.clause_id)}
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
        {isOpen && (
          <div className="finding-item__detail">
            <DetailPanel clause={clause} finding={finding} hideChip />
          </div>
        )}
      </li>
    );
  }

  return (
    <div ref={containerRef}>
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
        <details
          className="standard-details"
          open={standardOpen}
          onToggle={(e) => setStandardOpen(e.currentTarget.open)}
        >
          <summary>Standard clauses ({byLabel.standard.length})</summary>
          <ul className="finding-list">{byLabel.standard.map(renderItem)}</ul>
        </details>
      )}
      {findings.length === 0 && <p className="helper-text">No clauses were flagged.</p>}
    </div>
  );
}
