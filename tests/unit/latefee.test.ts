import { describe, expect, it } from "vitest";
import { lateFeeCap, findMonthlyRent, checkLateFee } from "@/lib/latefee";
import type { LateFeeExtraction } from "@/lib/types";

function extraction(overrides: Partial<LateFeeExtraction>): LateFeeExtraction {
  return {
    basis: "flat_per_occurrence",
    amount: null,
    initial_flat_amount: null,
    max_days: null,
    monthly_rent_in_clause: null,
    ...overrides,
  };
}

describe("lateFeeCap", () => {
  it("$500 rent -> $10 cap", () => {
    expect(lateFeeCap(500)).toBe(10);
  });
  it("$1,500 rent -> $60 cap", () => {
    expect(lateFeeCap(1500)).toBe(60);
  });
  it("$2,000 rent -> $85 cap", () => {
    expect(lateFeeCap(2000)).toBe(85);
  });
  it("$400 rent -> $10 cap (below the $500 floor)", () => {
    expect(lateFeeCap(400)).toBe(10);
  });
});

describe("findMonthlyRent", () => {
  it("finds 'monthly rent of $X'", () => {
    expect(findMonthlyRent("Tenant agrees to pay a monthly rent of $1,500.00 due on the 1st.")).toBe(1500);
  });

  it("finds 'rent is $X per month'", () => {
    expect(findMonthlyRent("The rent is $1,500 per month, payable in advance.")).toBe(1500);
  });

  it("finds '$X.XX per month' standalone", () => {
    expect(findMonthlyRent("Tenant shall pay $1,500.00 per month to Landlord.")).toBe(1500);
  });

  it("finds 'Monthly Rent: $X'", () => {
    expect(findMonthlyRent("Monthly Rent: $1,500")).toBe(1500);
  });

  it("returns null when no rent amount is stated", () => {
    expect(findMonthlyRent("This lease does not mention any dollar amounts at all.")).toBeNull();
  });

  it("returns null when multiple different amounts are found (ambiguous)", () => {
    const text = "The monthly rent of $1,500.00 is due, but rent is $1,600 per month for a 2BR unit.";
    expect(findMonthlyRent(text)).toBeNull();
  });

  it("is not confused by a late fee amount that isn't a monthly rent statement", () => {
    expect(findMonthlyRent("A late fee of $50 applies after 5 days.")).toBeNull();
  });
});

describe("checkLateFee", () => {
  it("flags a $100 flat late fee on $1,500 rent as over the cap", () => {
    const result = checkLateFee(
      extraction({ basis: "flat_per_occurrence", amount: 100 }),
      { amount: 1500, source: "user" },
    );
    expect(result.cap).toBe(60);
    expect(result.worst_case_monthly_fee).toBe(100);
    expect(result.over_cap).toBe(true);
    expect(result.explanation).toBe(
      "Rent $1,500 → Chicago cap is $10 + 5% × $1,000 = $60/month. This lease charges $100 (flat). That's $40 over the cap.",
    );
  });

  it("does not flag a $50 flat late fee on $1,500 rent (within cap)", () => {
    const result = checkLateFee(
      extraction({ basis: "flat_per_occurrence", amount: 50 }),
      { amount: 1500, source: "user" },
    );
    expect(result.cap).toBe(60);
    expect(result.over_cap).toBe(false);
  });

  it("uses the clause's own stated rent when the caller has none", () => {
    const result = checkLateFee(
      extraction({ basis: "flat_per_occurrence", amount: 100, monthly_rent_in_clause: 1500 }),
      { amount: null, source: null },
    );
    expect(result.monthly_rent).toBe(1500);
    expect(result.rent_source).toBe("lease_text");
    expect(result.cap).toBe(60);
    expect(result.over_cap).toBe(true);
  });

  it("prefers the caller's resolved rent over the clause's own stated rent", () => {
    const result = checkLateFee(
      extraction({ basis: "flat_per_occurrence", amount: 100, monthly_rent_in_clause: 2000 }),
      { amount: 1500, source: "user" },
    );
    expect(result.monthly_rent).toBe(1500);
    expect(result.rent_source).toBe("user");
  });

  it("computes per_day fees using max_days when given", () => {
    const result = checkLateFee(
      extraction({ basis: "per_day", amount: 10, max_days: 5 }),
      { amount: 1500, source: "user" },
    );
    expect(result.worst_case_monthly_fee).toBe(50);
    expect(result.over_cap).toBe(false); // 50 <= 60
  });

  it("assumes 30 days for per_day fees with no stated maximum", () => {
    const result = checkLateFee(extraction({ basis: "per_day", amount: 10 }), { amount: 1500, source: "user" });
    expect(result.worst_case_monthly_fee).toBe(300);
    expect(result.over_cap).toBe(true);
    expect(result.explanation).toMatch(/30 days/);
  });

  it("computes percent_of_rent fees using the resolved rent", () => {
    const result = checkLateFee(extraction({ basis: "percent_of_rent", amount: 10 }), {
      amount: 1500,
      source: "user",
    });
    expect(result.worst_case_monthly_fee).toBe(150); // 10% of 1500
    expect(result.over_cap).toBe(true);
  });

  it("returns null over_cap and cap when rent is unknown and not stated in the clause", () => {
    const result = checkLateFee(extraction({ basis: "flat_per_occurrence", amount: 100 }), {
      amount: null,
      source: null,
    });
    expect(result.monthly_rent).toBeNull();
    expect(result.cap).toBeNull();
    expect(result.over_cap).toBeNull();
    expect(result.explanation).toMatch(/enter your monthly rent/i);
  });

  it("returns null fee when basis is 'other' or numbers are missing", () => {
    const result = checkLateFee(extraction({ basis: "other" }), { amount: 1500, source: "user" });
    expect(result.worst_case_monthly_fee).toBeNull();
    expect(result.over_cap).toBeNull();
  });

  it("returns null fee for percent_of_rent with no amount", () => {
    const result = checkLateFee(extraction({ basis: "percent_of_rent", amount: null }), {
      amount: 1500,
      source: "user",
    });
    expect(result.worst_case_monthly_fee).toBeNull();
  });
});
