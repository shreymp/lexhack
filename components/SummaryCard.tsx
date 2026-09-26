import type { ClauseFinding, RiskLabel } from "@/lib/types";
import { labelInfo } from "@/components/labels";

const ORDER: RiskLabel[] = ["likely_unenforceable", "one_sided", "standard"];

interface SummaryCardProps {
  summary: string;
  findings: ClauseFinding[];
}

export default function SummaryCard({ summary, findings }: SummaryCardProps) {
  const counts: Record<RiskLabel, number> = { likely_unenforceable: 0, one_sided: 0, standard: 0 };
  for (const f of findings) counts[f.label]++;

  return (
    <div className="summary-card">
      <h2 className="section-title" style={{ marginBottom: 8 }}>
        Summary
      </h2>
      <p style={{ margin: 0 }}>{summary}</p>
      <div className="label-counts">
        {ORDER.map((label) => {
          const info = labelInfo(label);
          return (
            <span className={`chip chip--${info.key}`} key={label}>
              <span className="chip-icon" aria-hidden="true">
                {info.icon}
              </span>
              {counts[label]} {info.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
