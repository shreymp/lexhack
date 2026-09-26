"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import ResultsBanners from "@/components/ResultsBanners";
import SummaryCard from "@/components/SummaryCard";
import FindingsSidebar from "@/components/FindingsSidebar";
import MissingProtections from "@/components/MissingProtections";
import QuestionsToAsk from "@/components/QuestionsToAsk";
import DocumentView from "@/components/DocumentView";
import DetailPanel from "@/components/DetailPanel";
import HowWeChecked from "@/components/HowWeChecked";
import type { AnalysisResult } from "@/lib/types";
import sampleResultJson from "@/tests/fixtures/sample-result.json";

const FIXTURE_RESULT = sampleResultJson as unknown as AnalysisResult;

export default function ResultsPage() {
  return (
    <Suspense fallback={null}>
      <ResultsInner />
    </Suspense>
  );
}

function ResultsInner() {
  const searchParams = useSearchParams();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState(true);

  useEffect(() => {
    const useFixture = process.env.NODE_ENV !== "production" && searchParams.get("fixture") === "1";
    if (useFixture) {
      setResult(FIXTURE_RESULT);
      return;
    }
    try {
      const raw = sessionStorage.getItem("bys:result");
      if (!raw) {
        setLoadError("no_result");
        return;
      }
      setResult(JSON.parse(raw) as AnalysisResult);
    } catch {
      setLoadError("no_result");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) {
    return (
      <>
        <SiteHeader />
        <main>
          <div className="container no-result-card">
            <h1>{loadError ? "We couldn't find your results" : "Loading your results..."}</h1>
            <p className="helper-text">
              Results only live in this browser tab for this session. If you refreshed the page or
              came back later, you&apos;ll need to check your lease again.
            </p>
            <p>
              <Link href="/" className="btn btn-primary">
                Check a lease
              </Link>
            </p>
          </div>
        </main>
      </>
    );
  }

  const selectedClause = result.clauses.find((c) => c.id === selectedClauseId) ?? null;
  const selectedFinding = selectedClauseId
    ? result.findings.find((f) => f.clause_id === selectedClauseId) ?? null
    : null;

  return (
    <>
      <SiteHeader />
      <main>
        <div className="container results-header">
          <ResultsBanners provider={result.provider} coverage={result.coverage} warnings={result.warnings} />
          <SummaryCard summary={result.summary} findings={result.findings} />
        </div>

        <div className="container results-layout">
          <div className="results-sidebar">
            <FindingsSidebar
              clauses={result.clauses}
              findings={result.findings}
              selectedClauseId={selectedClauseId}
              onSelect={setSelectedClauseId}
            />
            <MissingProtections missing={result.missing} />
            <QuestionsToAsk questions={result.questions_to_ask} />
            <div>
              <h2 className="section-title">Clause details</h2>
              <DetailPanel clause={selectedClause} finding={selectedFinding} />
            </div>
          </div>

          <div>
            <button
              type="button"
              className="btn btn-secondary doc-toggle"
              onClick={() => setDocOpen((v) => !v)}
              aria-expanded={docOpen}
            >
              {docOpen ? "Hide full lease text" : "Show full lease text"}
            </button>
            <div className="document-card" style={{ display: docOpen ? undefined : "none" }}>
              <h2 className="section-title">Your lease</h2>
              <DocumentView
                sourceText={result.source_text}
                clauses={result.clauses}
                findings={result.findings}
                selectedClauseId={selectedClauseId}
                onSelectClause={setSelectedClauseId}
              />
            </div>
          </div>
        </div>
      </main>
      <HowWeChecked stats={result.stats} provider={result.provider} rulePack={result.rule_pack} />
    </>
  );
}
