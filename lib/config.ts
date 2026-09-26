// App-wide constants. Rename the product here only.
export const APP_NAME = "Before You Sign";
export const APP_TAGLINE =
  "A lease checker for Chicago renters that only calls a clause unenforceable when it can point to the law that says so.";

export const DISCLAIMER =
  "Not legal advice. Before You Sign explains your lease in plain English and points to published law, but it can make mistakes and does not replace a lawyer. Labels are \"likely,\" not verdicts.";

/** Legal-aid links shown on every results page. URLs confirmed via web search on 2026-09-26. */
export const LEGAL_AID_LINKS = [
  {
    name: "Law Center for Better Housing (Chicago)",
    url: "https://lcbh.org/get-legal-help/",
    note: "Free legal help for Chicago renters, including the Rentervention chat tool.",
  },
  {
    name: "Metropolitan Tenants Organization",
    url: "https://www.tenants-rights.org/",
    note: "Chicago tenant hotline and RLTO resources.",
  },
  {
    name: "Illinois Legal Aid Online",
    url: "https://www.illinoislegalaid.org/",
    note: "Statewide legal information and a directory of free legal aid.",
  },
] as const;

/** Official sources renters can check themselves. */
export const OFFICIAL_SOURCES = {
  rltoCode: "https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2639041",
  cityGuidePdf: "https://chicityclerk.s3.amazonaws.com/s3fs-public/pages/2021_LTB_08112021_C.pdf",
  cityRltoPage:
    "https://www.chicago.gov/city/en/depts/doh/provdrs/landlords/svcs/residential-landlord-and-tenant-ordinance.html",
} as const;

export const ANALYZE_BATCH_SIZE = 12;
