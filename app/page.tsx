"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import HowItWorks from "@/components/HowItWorks";
import TrustPoints from "@/components/TrustPoints";
import LeaseInputCard, { MAX_PDF_BYTES, type InputMode } from "@/components/LeaseInputCard";
import CoverageQuestions from "@/components/CoverageQuestions";
import PrivacyNote from "@/components/PrivacyNote";
import ProgressStatus from "@/components/ProgressStatus";
import type { ApiError, CoverageAnswers, YesNoUnsure } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();

  const [mode, setMode] = useState<InputMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);

  const [coverage, setCoverage] = useState<Partial<CoverageAnswers>>({});
  const [monthlyRent, setMonthlyRent] = useState("");

  const [showValidation, setShowValidation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(picked: File | null) {
    if (picked && picked.size > MAX_PDF_BYTES) {
      setFile(null);
      setFileError("That file is larger than 10 MB. Please upload a smaller PDF.");
      return;
    }
    setFileError(null);
    setFile(picked);
  }

  function handleCoverageChange(key: keyof CoverageAnswers, value: YesNoUnsure) {
    setCoverage((prev) => ({ ...prev, [key]: value }));
  }

  function hasInput() {
    return mode === "upload" ? Boolean(file) : text.trim().length > 0;
  }

  function coverageComplete(): boolean {
    return Boolean(coverage.in_chicago && coverage.owner_occupied_six_or_fewer && coverage.other_exclusion);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const inputOk = hasInput();
    const coverageOk = coverageComplete();
    if (!inputOk || !coverageOk) {
      setShowValidation(true);
      if (!inputOk) {
        setError(
          mode === "upload"
            ? "Please choose a PDF file to upload."
            : "Please paste your lease text.",
        );
      }
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      if (mode === "upload" && file) {
        formData.set("file", file);
      } else {
        formData.set("text", text);
      }
      formData.set("coverage", JSON.stringify(coverage as CoverageAnswers));
      if (monthlyRent.trim()) {
        formData.set("monthly_rent", monthlyRent.trim());
      }

      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        const apiError = data as ApiError;
        setError(apiError.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      try {
        sessionStorage.setItem("bys:result", JSON.stringify(data));
      } catch {
        setError(
          "Your results were ready, but they were too large for this browser tab to hold. Try a shorter lease, or a different browser.",
        );
        setSubmitting(false);
        return;
      }

      router.push("/results");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main>
        <div className="container">
          <HowItWorks />
          <TrustPoints />

          <section aria-labelledby="analyze-title">
            <h2 className="section-title" id="analyze-title">
              Check your lease
            </h2>

            <form onSubmit={handleSubmit} noValidate>
              <div style={{ display: "grid", gap: 20 }}>
                <LeaseInputCard
                  mode={mode}
                  onModeChange={setMode}
                  file={file}
                  onFileChange={handleFileChange}
                  text={text}
                  onTextChange={setText}
                  fileError={fileError}
                />

                <div className="card">
                  <CoverageQuestions
                    answers={coverage}
                    onChange={handleCoverageChange}
                    showErrors={showValidation}
                  />
                </div>

                <div className="card">
                  <label htmlFor="monthly-rent">Monthly rent ($)</label>
                  <input
                    id="monthly-rent"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="rent-field"
                    value={monthlyRent}
                    onChange={(e) => setMonthlyRent(e.target.value)}
                    placeholder="e.g. 1500"
                  />
                  <p className="helper-text">
                    Used to check the late-fee cap. Leave blank to read it from the lease.
                  </p>
                </div>

                <PrivacyNote />

                {error && (
                  <div className="alert alert-error" role="alert" aria-live="assertive">
                    <span className="alert-icon" aria-hidden="true">
                      &#9888;
                    </span>
                    <span>{error}</span>
                  </div>
                )}

                {submitting ? (
                  <ProgressStatus />
                ) : (
                  <button type="submit" className="btn btn-primary btn-block">
                    Check my lease
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      </main>
    </>
  );
}
