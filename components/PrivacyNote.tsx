import { DISCLAIMER } from "@/lib/config";

export default function PrivacyNote() {
  return (
    <div className="privacy-note">
      <p style={{ marginBottom: "0.5em" }}>
        <strong>Your privacy:</strong> Your lease text is sent to an AI service for analysis. We
        don&apos;t save it.
      </p>
      <p style={{ marginBottom: 0 }}>{DISCLAIMER}</p>
    </div>
  );
}
