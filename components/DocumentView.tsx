"use client";

import { useEffect, useRef } from "react";
import type { Clause, ClauseFinding } from "@/lib/types";
import { buildSegments } from "@/components/highlight";

interface DocumentViewProps {
  sourceText: string;
  clauses: Clause[];
  findings: ClauseFinding[];
  selectedClauseId: string | null;
  onSelectClause: (clauseId: string) => void;
}

export default function DocumentView({
  sourceText,
  clauses,
  findings,
  selectedClauseId,
  onSelectClause,
}: DocumentViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const segments = buildSegments(sourceText, clauses, findings);

  useEffect(() => {
    if (!selectedClauseId || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-clause-id="${CSS.escape(selectedClauseId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedClauseId]);

  return (
    <div className="document-view" ref={containerRef}>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return <span key={i}>{seg.text}</span>;
        }
        const labelKey = seg.label ?? "neutral";
        const isSelected = seg.clauseId === selectedClauseId;
        return (
          <button
            key={i}
            type="button"
            data-clause-id={seg.clauseId}
            className={[
              "clause-span",
              `clause-span--${labelKey}`,
              isSelected ? "clause-span--selected" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={isSelected}
            onClick={() => onSelectClause(seg.clauseId)}
          >
            {seg.parts.map((part, j) =>
              part.marked ? <mark key={j}>{part.text}</mark> : <span key={j}>{part.text}</span>,
            )}
          </button>
        );
      })}
    </div>
  );
}
