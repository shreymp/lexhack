import Link from "next/link";
import { OFFICIAL_SOURCES } from "@/lib/config";
import type { AnalysisResult } from "@/lib/types";

interface HowWeCheckedProps {
  stats: AnalysisResult["stats"];
  provider: AnalysisResult["provider"];
  rulePack: AnalysisResult["rule_pack"];
}

export default function HowWeChecked({ stats, provider, rulePack }: HowWeCheckedProps) {
  return (
    <footer className="site-footer">
      <div className="container how-we-checked">
        <h2 className="section-title">How we checked</h2>

        <p>
          {stats.quotes_rejected} quote{stats.quotes_rejected === 1 ? "" : "s"} the AI produced that
          we couldn&apos;t find in your lease were removed. {stats.rule_citations_downgraded} citation
          {stats.rule_citations_downgraded === 1 ? " was" : "s were"} downgraded.
        </p>

        <dl>
          <dt>AI provider</dt>
          <dd>
            {provider.name} ({provider.model}){provider.is_mock ? " — demo mode" : ""}
          </dd>
          <dt>Law source</dt>
          <dd>
            {rulePack.name}, version {rulePack.version}, checked {rulePack.date_verified}
          </dd>
        </dl>

        <ul>
          {rulePack.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>

        <p>
          <strong>Check the official sources yourself:</strong>{" "}
          <a href={OFFICIAL_SOURCES.rltoCode} target="_blank" rel="noopener noreferrer">
            Municipal Code
          </a>
          {", "}
          <a href={OFFICIAL_SOURCES.cityGuidePdf} target="_blank" rel="noopener noreferrer">
            City RLTO guide (PDF)
          </a>
          {", "}
          <a href={OFFICIAL_SOURCES.cityRltoPage} target="_blank" rel="noopener noreferrer">
            City RLTO page
          </a>
        </p>

        <p>
          <Link href="/" className="btn btn-secondary">
            Start over
          </Link>
        </p>
      </div>
    </footer>
  );
}
