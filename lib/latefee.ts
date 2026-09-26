// Deterministic math for the Chicago RLTO late-fee cap (§ 5-12-140(h)/(i)).
// The model only extracts numbers off the clause (see LateFeeExtraction); this
// module -- not the model -- decides the cap and whether a fee exceeds it.
import type { LateFeeCheck, LateFeeExtraction } from "@/lib/types";

/** Rounds to the nearest cent, avoiding common floating point artifacts. */
function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMoney(n: number): string {
  const cents = Math.round(n * 100);
  const isWhole = cents % 100 === 0;
  const dollars = cents / 100;
  const formatted = dollars.toLocaleString("en-US", {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `$${formatted}`;
}

/**
 * Chicago RLTO § 5-12-140(h)/(i) cap: $10/month for the first $500 of monthly
 * rent, plus 5% per month of any rent above $500.
 */
export function lateFeeCap(monthlyRent: number): number {
  if (monthlyRent <= 500) return roundCents(10);
  return roundCents(10 + 0.05 * (monthlyRent - 500));
}

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, ""));
}

// Conservative patterns for an explicitly-stated monthly rent amount. We only
// ever use text the lease actually states this way; anything else is left as
// "unknown" rather than guessed.
const RENT_PATTERNS: RegExp[] = [
  // "monthly rent of $1,500.00", "Monthly Rent: $1,500"
  /monthly rent[^\d$]{0,20}\$\s?([\d,]+(?:\.\d{1,2})?)/gi,
  // "rent is $1,500 per month", "rent of $1,500.00 per month"
  /rent(?:\s+(?:is|shall be|of))?\s*\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:per month|\/\s*month|monthly)/gi,
  // "$1,500.00 per month" (no preceding "rent" word required)
  /\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:per month|\/\s*month)/gi,
];

/**
 * Looks for an explicit statement of the monthly rent amount in the lease
 * text. Returns null if none is found, or if multiple DIFFERENT amounts are
 * found (ambiguous) -- we never guess.
 */
export function findMonthlyRent(text: string): number | null {
  const found = new Set<number>();

  for (const re of RENT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const amount = parseAmount(m[1]);
      if (!Number.isNaN(amount) && amount > 0) found.add(amount);
    }
  }

  if (found.size !== 1) return null;
  return [...found][0];
}

function describeBasisCharge(x: LateFeeExtraction, worstCaseFee: number | null): string | null {
  switch (x.basis) {
    case "flat_per_occurrence": {
      if (worstCaseFee == null) return null;
      return `This lease charges ${formatMoney(worstCaseFee)} (flat).`;
    }
    case "per_day": {
      if (x.amount == null) return null;
      const initial = x.initial_flat_amount ?? 0;
      const initialPart = initial > 0 ? `${formatMoney(initial)} plus ` : "";
      if (x.max_days != null) {
        return (
          `This lease charges ${initialPart}${formatMoney(x.amount)}/day, up to ${x.max_days} day` +
          `${x.max_days === 1 ? "" : "s"} late (worst case ${formatMoney(worstCaseFee ?? 0)}).`
        );
      }
      return (
        `This lease charges ${initialPart}${formatMoney(x.amount)}/day with no stated maximum, so we assumed ` +
        `rent could be 30 days late (worst case ${formatMoney(worstCaseFee ?? 0)}).`
      );
    }
    case "percent_of_rent": {
      if (x.amount == null || worstCaseFee == null) return null;
      const initial = x.initial_flat_amount ?? 0;
      const initialPart = initial > 0 ? `${formatMoney(initial)} plus ` : "";
      return `This lease charges ${initialPart}${x.amount}% of rent (${formatMoney(worstCaseFee)}).`;
    }
    default:
      return null;
  }
}

/**
 * Computes the worst-case monthly late fee (or early-payment-discount)
 * amount a clause could charge, in dollars, given the extracted numbers and
 * the (already-resolved) monthly rent. Returns null when there isn't enough
 * information to compute a number -- code never guesses.
 */
function computeWorstCaseFee(x: LateFeeExtraction, rentAmount: number | null): number | null {
  switch (x.basis) {
    case "flat_per_occurrence": {
      const amount = x.initial_flat_amount ?? x.amount;
      return amount == null ? null : roundCents(amount);
    }
    case "per_day": {
      if (x.amount == null) return null;
      const initial = x.initial_flat_amount ?? 0;
      const days = x.max_days ?? 30;
      return roundCents(initial + x.amount * days);
    }
    case "percent_of_rent": {
      if (x.amount == null || rentAmount == null) return null;
      const initial = x.initial_flat_amount ?? 0;
      return roundCents(initial + (rentAmount * x.amount) / 100);
    }
    case "other":
    default:
      return null;
  }
}

export function checkLateFee(
  x: LateFeeExtraction,
  rent: { amount: number | null; source: "user" | "lease_text" | null },
): LateFeeCheck {
  // The caller resolves rent from the user's input first; only fall back to a
  // rent figure the clause itself states if the caller has nothing at all.
  let monthlyRent = rent.amount;
  let rentSource = rent.source;
  if (monthlyRent == null && x.monthly_rent_in_clause != null) {
    monthlyRent = x.monthly_rent_in_clause;
    rentSource = "lease_text";
  }

  const cap = monthlyRent != null ? lateFeeCap(monthlyRent) : null;
  const worstCaseFee = computeWorstCaseFee(x, monthlyRent);

  let overCap: boolean | null = null;
  if (worstCaseFee != null && cap != null) {
    overCap = roundCents(worstCaseFee) > cap;
  }

  const explanation = buildExplanation(x, monthlyRent, cap, worstCaseFee, overCap);

  return {
    monthly_rent: monthlyRent,
    rent_source: monthlyRent != null ? rentSource : null,
    worst_case_monthly_fee: worstCaseFee,
    cap,
    over_cap: overCap,
    explanation,
  };
}

function buildExplanation(
  x: LateFeeExtraction,
  rentAmount: number | null,
  cap: number | null,
  fee: number | null,
  overCap: boolean | null,
): string {
  if (rentAmount == null) {
    const chargePart = describeBasisChargeNoRent(x);
    return chargePart
      ? `${chargePart} Enter your monthly rent on the upload page to check this against the cap.`
      : "Enter your monthly rent on the upload page to check this against the cap.";
  }

  const capPart =
    rentAmount <= 500
      ? "Chicago cap is $10/month"
      : `Chicago cap is $10 + 5% × ${formatMoney(rentAmount - 500)} = ${formatMoney(cap as number)}/month`;
  const prefix = `Rent ${formatMoney(rentAmount)} → ${capPart}.`;

  const chargePart = describeBasisCharge(x, fee);
  if (chargePart == null || fee == null) {
    return `${prefix} We couldn't determine the dollar amount this clause charges, so we can't compare it to the cap.`;
  }

  if (overCap === true) {
    return `${prefix} ${chargePart} That's ${formatMoney(fee - (cap as number))} over the cap.`;
  }
  if (overCap === false) {
    return `${prefix} ${chargePart} That's within the cap.`;
  }
  return `${prefix} ${chargePart}`;
}

/** Same as describeBasisCharge, but for when we don't know the rent yet (percent_of_rent can't resolve). */
function describeBasisChargeNoRent(x: LateFeeExtraction): string | null {
  if (x.basis === "percent_of_rent") {
    if (x.amount == null) return null;
    const initial = x.initial_flat_amount ?? 0;
    const initialPart = initial > 0 ? `${formatMoney(initial)} plus ` : "";
    return `This lease charges ${initialPart}${x.amount}% of rent.`;
  }
  return describeBasisCharge(x, computeWorstCaseFee(x, null));
}
