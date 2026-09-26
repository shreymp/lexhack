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

  const selectedHasFinding = Boolean(
    selectedClauseId && result.findings.some((f) => f.clause_id === selectedClauseId),
  );
  const selectedIsUnanalyzed = Boolean(selectedClauseId) && !selectedHasFinding;

  // Clicking a clause in the document always selects/expands it, even if it's
  // already selected. Clicking a finding card toggles it open/closed instead.
  function selectFromDocument(clauseId: string) {
    setSelectedClauseId(clauseId);
  }
  function toggleFromCard(clauseId: string) {
    setSelectedClauseId((prev) => (prev === clauseId ? null : clauseId));
  }

  return (
    <>
      <SiteHeader />
      <main>
        <div className="container results-header">
          <ResultsBanners provider={result.provider} coverage={result.coverage} warnings={result.warnings} />
        </div>

        <div className="container results-layout">
          <div className="doc-column">
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
                onSelectClause={selectFromDocument}
              />
            </div>
          </div>

          <div className="findings-column">
            <SummaryCard summary={result.summary} findings={result.findings} />
            {selectedIsUnanalyzed && (
              <p className="helper-text" role="status" style={{ marginTop: -4 }}>
                This part of the lease wasn&apos;t analyzed as its own clause.
              </p>
            )}
            <FindingsSidebar
              clauses={result.clauses}
              findings={result.findings}
              selectedClauseId={selectedClauseId}
              onToggle={toggleFromCard}
            />
            <MissingProtections missing={result.missing} />
            <QuestionsToAsk questions={result.questions_to_ask} />
          </div>
        </div>
      </main>
      <HowWeChecked stats={result.stats} provider={result.provider} rulePack={result.rule_pack} />
    </>
  );
}
