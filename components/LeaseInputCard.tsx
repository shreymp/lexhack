"use client";

import { useId, useRef, useState } from "react";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export type InputMode = "upload" | "paste";

interface LeaseInputCardProps {
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  text: string;
  onTextChange: (text: string) => void;
  fileError: string | null;
}

export default function LeaseInputCard({
  mode,
  onModeChange,
  file,
  onFileChange,
  text,
  onTextChange,
  fileError,
}: LeaseInputCardProps) {
  const uploadTabId = useId();
  const pasteTabId = useId();
  const uploadPanelId = useId();
  const pastePanelId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "error">("idle");

  async function handleTrySample() {
    setSampleState("loading");
    try {
      const res = await fetch("/sample-lease.txt");
      if (!res.ok) {
        setSampleState("error");
        return;
      }
      const sampleText = await res.text();
      onModeChange("paste");
      onTextChange(sampleText);
      setSampleState("idle");
    } catch {
      setSampleState("error");
    }
  }

  return (
    <div className="card">
      <div className="tabs" role="tablist" aria-label="How you'll share your lease">
        <button
          type="button"
          role="tab"
          id={uploadTabId}
          aria-selected={mode === "upload"}
          aria-controls={uploadPanelId}
          className="tab-btn"
          onClick={() => onModeChange("upload")}
        >
          Upload PDF
        </button>
        <button
          type="button"
          role="tab"
          id={pasteTabId}
          aria-selected={mode === "paste"}
          aria-controls={pastePanelId}
          className="tab-btn"
          onClick={() => onModeChange("paste")}
        >
          Paste text
        </button>
      </div>

      {mode === "upload" ? (
        <div role="tabpanel" id={uploadPanelId} aria-labelledby={uploadTabId}>
          <label htmlFor="lease-file">Lease PDF (up to 10 MB)</label>
          <input
            ref={fileInputRef}
            id="lease-file"
            type="file"
            accept="application/pdf"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          />
          {file && (
            <p className="filename-chip">
              <span aria-hidden="true">&#128196;</span> {file.name}
            </p>
          )}
          {fileError && (
            <p className="helper-text" style={{ color: "var(--danger-text)" }}>
              {fileError}
            </p>
          )}
          <p className="helper-text">
            Your PDF is sent to our server to read its text, then analyzed by an AI service. We
            don&apos;t save it.
          </p>
        </div>
      ) : (
        <div role="tabpanel" id={pastePanelId} aria-labelledby={pasteTabId}>
          <label htmlFor="lease-text">Lease text</label>
          <textarea
            id="lease-text"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="Paste the full text of your lease here..."
          />
        </div>
      )}

      <div className="sample-row">
        <button type="button" className="btn btn-secondary" onClick={handleTrySample} disabled={sampleState === "loading"}>
          {sampleState === "loading" ? "Loading sample..." : "Try a sample lease"}
        </button>
        {sampleState === "error" && (
          <p className="helper-text" role="status">
            The sample lease isn&apos;t available right now. You can still upload or paste your own.
          </p>
        )}
      </div>
    </div>
  );
}
