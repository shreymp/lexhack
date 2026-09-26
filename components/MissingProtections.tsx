import type { MissingProtection } from "@/lib/types";
import { getRule } from "@/lib/rules";
import CopyButton from "@/components/CopyButton";

interface MissingProtectionsProps {
  missing: MissingProtection[];
}

export default function MissingProtections({ missing }: MissingProtectionsProps) {
  const notFound = missing.filter((m) => m.status === "not_found");
  if (notFound.length === 0) return null;

  return (
    <section aria-labelledby="missing-title">
      <h2 className="section-title" id="missing-title">
        Missing protections
      </h2>
      <ul className="missing-list">
        {notFound.map((item) => {
          const rule = getRule(item.rule_id);
          return (
            <li className="missing-item" key={item.rule_id}>
              <h3>
                <span aria-hidden="true">&#9888;</span> {item.title}
              </h3>
              <p>{item.explanation}</p>
              <div className="ask-box">
                <p>{item.what_to_ask}</p>
                <CopyButton text={item.what_to_ask} label="Copy" />
              </div>
              {rule && (
                <p className="citation-line">
                  <strong>{rule.citation}</strong> &mdash; {rule.summary}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
