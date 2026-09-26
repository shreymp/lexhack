"use client";

import type { CoverageAnswers, YesNoUnsure } from "@/lib/types";

interface Question {
  key: keyof CoverageAnswers;
  question: string;
  help: string;
}

const QUESTIONS: Question[] = [
  {
    key: "in_chicago",
    question: "Is the rental unit in the City of Chicago?",
    help: "The Chicago RLTO only applies inside city limits.",
  },
  {
    key: "owner_occupied_six_or_fewer",
    question: "Does the owner live in the building, and does it have 6 or fewer units?",
    help: "Owner-occupied buildings with 6 or fewer units are mostly excluded from the RLTO.",
  },
  {
    key: "other_exclusion",
    question:
      "Is it a hotel/motel, dorm or school housing, shelter, co-op, or housing tied to a job with the landlord?",
    help: "These are also excluded from most of the RLTO.",
  },
];

const OPTIONS: { value: YesNoUnsure; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

interface CoverageQuestionsProps {
  answers: Partial<CoverageAnswers>;
  onChange: (key: keyof CoverageAnswers, value: YesNoUnsure) => void;
  showErrors: boolean;
}

export default function CoverageQuestions({ answers, onChange, showErrors }: CoverageQuestionsProps) {
  return (
    <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
      <legend className="visually-hidden">Coverage questions</legend>
      <p className="helper-text" style={{ marginTop: 0 }}>
        These answers decide whether the Chicago RLTO (§ 5-12-020) applies to your lease. If
        you&apos;re not sure, pick &ldquo;Not sure&rdquo; &mdash; we&apos;ll say so in your results.
      </p>
      {QUESTIONS.map((q) => {
        const answered = answers[q.key];
        const missing = showErrors && !answered;
        return (
          <div className="coverage-question" key={q.key}>
            <span className="field-label" id={`${q.key}-label`}>
              {q.question}
            </span>
            <p className="helper-text" style={{ marginTop: 0 }}>
              {q.help}
            </p>
            <div className="radio-group" role="radiogroup" aria-labelledby={`${q.key}-label`}>
              {OPTIONS.map((opt) => (
                <label className="radio-option" key={opt.value}>
                  <input
                    type="radio"
                    name={q.key}
                    value={opt.value}
                    checked={answered === opt.value}
                    onChange={() => onChange(q.key, opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
            {missing && (
              <p className="helper-text" style={{ color: "var(--danger-text)" }} role="alert">
                Please answer this question.
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
