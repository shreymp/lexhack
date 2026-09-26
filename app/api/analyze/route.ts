// POST /api/analyze - see lib/types.ts for the documented request/response contract.
// No persistence: the lease text and result exist only for the duration of this request.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runAnalysis, SourceTooLongError } from "@/lib/pipeline";
import { extractPdfText, PdfNoTextError } from "@/lib/extract";
import { LlmUnavailableError } from "@/lib/llm/types";
import { MAX_PDF_BYTES } from "@/lib/types";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const yesNoUnsureSchema = z.enum(["yes", "no", "unsure"]);
const coverageAnswersSchema = z.object({
  in_chicago: yesNoUnsureSchema,
  owner_occupied_six_or_fewer: yesNoUnsureSchema,
  other_exclusion: yesNoUnsureSchema,
});

function errorResponse(error: string, code: ApiError["code"], status: number): NextResponse<ApiError> {
  return NextResponse.json({ error, code }, { status });
}

// Upper bound for the whole multipart body: the PDF limit plus room for the text
// fields. Checked before parsing so an oversized upload is never buffered.
const MAX_BODY_BYTES = MAX_PDF_BYTES + 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(
      `That upload is too large (max ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB).`,
      "bad_request",
      413,
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("Could not read the submitted form.", "bad_request", 400);
  }

  const fileEntry = formData.get("file");
  const textEntry = formData.get("text");
  const file = fileEntry instanceof File ? fileEntry : null;
  const text = typeof textEntry === "string" ? textEntry : null;

  const hasFile = file !== null && file.size > 0;
  const hasText = text !== null && text.trim().length > 0;

  if (hasFile === hasText) {
    return errorResponse(
      hasFile
        ? "Please provide either a pasted lease or a PDF file, not both."
        : "Please paste your lease text or upload a PDF file.",
      "bad_request",
      400,
    );
  }

  const coverageRaw = formData.get("coverage");
  if (typeof coverageRaw !== "string") {
    return errorResponse("Missing the coverage answers.", "bad_request", 400);
  }
  let coverageJson: unknown;
  try {
    coverageJson = JSON.parse(coverageRaw);
  } catch {
    return errorResponse("The coverage answers were not valid JSON.", "bad_request", 400);
  }
  const coverageParsed = coverageAnswersSchema.safeParse(coverageJson);
  if (!coverageParsed.success) {
    return errorResponse("The coverage answers were missing or invalid.", "bad_request", 400);
  }

  let monthlyRent: number | null = null;
  const monthlyRentRaw = formData.get("monthly_rent");
  if (typeof monthlyRentRaw === "string" && monthlyRentRaw.trim() !== "") {
    const parsedRent = Number(monthlyRentRaw);
    if (!Number.isFinite(parsedRent) || parsedRent <= 0) {
      return errorResponse("Monthly rent must be a positive number.", "bad_request", 400);
    }
    monthlyRent = parsedRent;
  }

  let sourceText: string;
  let sourceKind: "pdf" | "text";

  if (hasFile && file) {
    const isPdfType = file.type === "application/pdf";
    const isPdfName = file.name.toLowerCase().endsWith(".pdf");
    if (!isPdfType && !isPdfName) {
      return errorResponse("Please upload a PDF file.", "bad_request", 400);
    }
    if (file.size > MAX_PDF_BYTES) {
      return errorResponse(
        `That PDF is too large (max ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB).`,
        "bad_request",
        413,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return errorResponse("Could not read the uploaded PDF.", "bad_request", 400);
    }

    try {
      sourceText = await extractPdfText(bytes);
    } catch (err) {
      if (err instanceof PdfNoTextError) {
        return errorResponse(
          "We couldn't find any text in that PDF - it may be a scanned image. Try pasting the lease text instead.",
          "pdf_no_text",
          422,
        );
      }
      console.error("PDF extraction failed:", err instanceof Error ? err.message : "unknown error");
      return errorResponse("We couldn't read that PDF.", "bad_request", 422);
    }
    sourceKind = "pdf";
  } else {
    sourceText = text as string;
    sourceKind = "text";
  }

  try {
    const result = await runAnalysis({
      sourceText,
      sourceKind,
      coverage: coverageParsed.data,
      monthlyRent,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof SourceTooLongError) {
      return errorResponse(err.message, "too_long", 413);
    }
    if (err instanceof LlmUnavailableError) {
      return errorResponse(
        "The AI service is currently unavailable. Please try again in a moment.",
        "llm_unavailable",
        502,
      );
    }
    // Never log the lease text or any API keys - only the error's own message.
    console.error("Unexpected error in /api/analyze:", err instanceof Error ? err.message : "unknown error");
    return errorResponse("Something went wrong while analyzing the lease.", "internal", 500);
  }
}
