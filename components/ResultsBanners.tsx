import { DISCLAIMER, LEGAL_AID_LINKS } from "@/lib/config";
import type { Coverage, ProviderInfo } from "@/lib/types";

interface ResultsBannersProps {
  provider: ProviderInfo;
  coverage: Coverage;
  warnings: string[];
}

export default function ResultsBanners({ provider, coverage, warnings }: ResultsBannersProps) {
  return (
    <div>
      <div className="banner banner--disclaimer" role="note">
        <span className="banner-icon" aria-hidden="true">
          &#8505;
        </span>
        <div>
          <p style={{ margin: 0 }}>{DISCLAIMER}</p>
          <ul className="legal-aid-links">
            {LEGAL_AID_LINKS.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {provider.is_mock && (
        <div className="banner banner--demo" role="note">
          <span className="banner-icon" aria-hidden="true">
            &#9881;
          </span>
          <p style={{ margin: 0 }}>Demo mode &mdash; keyword rules, not AI.</p>
        </div>
      )}

      {!coverage.rule_pack_applies && (
        <div className="banner banner--coverage" role="note">
          <span className="banner-icon" aria-hidden="true">
            &#9650;
          </span>
          <p style={{ margin: 0 }}>{coverage.reason}</p>
        </div>
      )}

      {coverage.rule_pack_applies && coverage.uncertain && (
        <div className="banner banner--coverage" role="note">
          <span className="banner-icon" aria-hidden="true">
            &#9650;
          </span>
          <p style={{ margin: 0 }}>{coverage.reason}</p>
        </div>
      )}

      {warnings.map((w, i) => (
        <div className="banner banner--warning" role="alert" key={i}>
          <span className="banner-icon" aria-hidden="true">
            &#9888;
          </span>
          <p style={{ margin: 0 }}>{w}</p>
        </div>
      ))}
    </div>
  );
}
