import type { Clause, ClauseFinding } from "@/lib/types";
import { getRule, RULE_PACK } from "@/lib/rules";
import { labelInfo, NEUTRAL_LABEL } from "@/components/labels";
import CopyButton from "@/components/CopyButton";

interface DetailPanelProps {
  clause: Clause | null;
  finding: ClauseFinding | null;
}

export default function DetailPanel({ clause, finding }: DetailPanelProps) {
  if (!clause) {
    return (
      <div className="detail-panel">
        <p className="helper-text" style={{ marginTop: 0 }}>
          Select a highlighted clause in the document, or an item in the list, to see the details
          here.
        </p>
      </div>
    );
  }

  if (!finding) {
    return (
      <div className="detail-panel">
        <span className="chip chip--neutral">
          <span className="chip-icon" aria-hidden="true">
            {NEUTRAL_LABEL.icon}
          </span>
          {NEUTRAL_LABEL.name}
        </span>
        <p style={{ marginTop: 10 }}>{NEUTRAL_LABEL.description}</p>
      </div>
    );
  }

  const info = labelInfo(finding.label);
  const rule = getRule(finding.rule_id);
  const remedy = rule
    ? RULE_PACK.remedies_context.find((r) => r.citation === rule.citation) ?? RULE_PACK.remedies_context[0]
    : undefined;

  return (
    <div className="detail-panel">
      <span className={`chip chip--${info.key}`}>
        <span className="chip-icon" aria-hidden="true">
          {info.icon}
        </span>
        {info.name}
      </span>

      <div className="detail-block" style={{ marginTop: 14 }}>
        <h4>In plain English</h4>
        <p style={{ margin: 0 }}>{finding.plain_english}</p>
      </div>

      <div className="detail-block">
        <h4>Why we flagged this</h4>
        <p style={{ margin: 0 }}>{finding.reasoning}</p>
      </div>

      <div className="detail-block">
        <h4>Exact text from your lease</h4>
        <blockquote className="quote-block">&ldquo;{finding.quote}&rdquo;</blockquote>
      </div>

      {finding.label === "likely_unenforceable" && rule && (
        <div className="detail-block">
          <h4>What the law says</h4>
          <p style={{ marginBottom: 6 }}>
            <strong>{rule.citation}</strong> &mdash; {rule.summary}
          </p>
          <blockquote className="official-text">{rule.official_text}</blockquote>
          <p className="rule-status-note">
            Rule text checked against the City&apos;s 2021 RLTO guide; not yet reviewed by a lawyer.
          </p>
          {remedy && (
            <p className="helper-text">
              <strong>If a landlord tries to enforce it:</strong> {remedy.summary}
            </p>
          )}
        </div>
      )}

      {finding.late_fee_check && (
        <div className="detail-block">
          <h4>Late-fee check</h4>
          <p style={{ margin: 0 }}>{finding.late_fee_check.explanation}</p>
        </div>
      )}

      {finding.verification.label_adjusted && (
        <div className="detail-block">
          <div className="adjusted-note">
            <strong>Our checker changed the AI&apos;s label:</strong>{" "}
            {finding.verification.label_adjusted.reason}
          </div>
        </div>
      )}

      {finding.suggested_message && (
        <div className="detail-block">
          <h4>Message you could send</h4>
          <p>{finding.suggested_message}</p>
          <CopyButton text={finding.suggested_message} />
        </div>
      )}
    </div>
  );
}
