"use client";

import { useEffect, useState } from "react";

const STEPS = [
  "Reading your lease...",
  "Splitting it into clauses...",
  "Checking each clause against Chicago law...",
  "Verifying every quote against your lease...",
];

export default function ProgressStatus() {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((i) => (i + 1) % STEPS.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="progress" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{STEPS[stepIndex]}</span>
    </div>
  );
}
