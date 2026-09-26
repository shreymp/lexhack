// Single source of truth for how risk labels are displayed in the UI.
// The word "illegal" must never appear anywhere in this file or its callers.
import type { RiskLabel } from "@/lib/types";

export interface LabelInfo {
  /** Plain-language name shown to renters. */
  name: string;
  /** Short text glyph shown alongside color so meaning never depends on color alone. */
  icon: string;
  /** CSS class suffix, used as `chip--${key}` / `clause-span--${key}`. */
  key: RiskLabel;
  description: string;
}

export const LABELS: Record<RiskLabel, LabelInfo> = {
  likely_unenforceable: {
    name: "Likely unenforceable",
    icon: "✕", // ✕
    key: "likely_unenforceable",
    description: "This clause conflicts with a specific law we can point to.",
  },
  one_sided: {
    name: "One-sided or unusual",
    icon: "▲", // ▲
    key: "one_sided",
    description: "Worth asking about, even though we can't point to a specific rule it breaks.",
  },
  standard: {
    name: "Standard",
    icon: "✓", // ✓
    key: "standard",
    description: "A common clause that didn't raise a concern.",
  },
};

export function labelInfo(label: RiskLabel): LabelInfo {
  return LABELS[label];
}

export const NEUTRAL_LABEL = {
  name: "Not analyzed",
  icon: "–", // –
  description: "This part of the lease wasn't flagged or analyzed as its own clause.",
};
