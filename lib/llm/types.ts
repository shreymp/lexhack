// Provider-agnostic contract for the LLM layer. Every provider (anthropic,
// openai-compatible, mock) implements LlmProvider and is interchangeable.
import type { ProviderInfo } from "@/lib/types";

/** One structured-JSON call to an LLM provider. */
export interface JsonTask {
  task: "analyze_batch" | "summarize";
  system: string;
  user: string;
  /** Name used for the forced tool call / response_format schema name. */
  schemaName: string;
  /** JSON Schema the provider should force the response to match. */
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  /** Structured input mirrored in `user`; used by the mock provider to avoid re-parsing prose. */
  payload: unknown;
}

export interface LlmProvider {
  info: ProviderInfo;
  /** Returns the parsed JSON response (validated by the caller against zod schemas). */
  completeJson(t: JsonTask): Promise<unknown>;
}

/** Thrown when a provider cannot be reached or reliably used (network, auth, bad config). */
export class LlmUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmUnavailableError";
  }
}
