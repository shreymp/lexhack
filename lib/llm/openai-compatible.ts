// Provider for any OpenAI-compatible /chat/completions endpoint (e.g. OpenRouter,
// a local vLLM/Ollama server). Uses plain fetch - no SDK is installed for this.
import { LlmUnavailableError, type JsonTask, type LlmProvider } from "@/lib/llm/types";
import type { ProviderInfo } from "@/lib/types";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RATE_LIMIT_RETRIES = 4;
const MAX_BACKOFF_MS = 30_000;

/** Internal signal that the server rejected `response_format: json_schema` and we should retry with json_object. */
class ResponseFormatRejectedError extends Error {}

/** Internal signal for a 429/502/503 that is worth retrying after a pause. */
class RetryableStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
    readonly detail: string,
  ) {
    super(`status ${status}`);
  }
  toUnavailable(): LlmUnavailableError {
    return new LlmUnavailableError(`openai-compatible API error (status ${this.status})${this.detail}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** A short, single-line excerpt of the provider's error body, for diagnosis. The body never contains our key. */
function errorDetail(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim().slice(0, 200);
  return oneLine ? `: ${oneLine}` : "";
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly info: ProviderInfo;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  private readonly reasoningEffort: string | undefined;

  constructor(model: string, apiKey: string, baseUrl?: string, opts: { reasoningEffort?: string } = {}) {
    this.info = { name: "openai-compatible", model, is_mock: false };
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.reasoningEffort = opts.reasoningEffort;
  }

  async completeJson(t: JsonTask): Promise<unknown> {
    try {
      return await this.requestWithBackoff(t, false);
    } catch (err) {
      if (err instanceof ResponseFormatRejectedError) {
        return await this.requestWithBackoff(t, true);
      }
      throw err;
    }
  }

  /** Retries rate-limit (429) and overload (502/503) responses, honoring Retry-After. Free-tier models rate-limit hard. */
  private async requestWithBackoff(t: JsonTask, schemaInSystemPrompt: boolean): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(t, schemaInSystemPrompt);
      } catch (err) {
        if (!(err instanceof RetryableStatusError) || attempt >= MAX_RATE_LIMIT_RETRIES) {
          throw err instanceof RetryableStatusError ? err.toUnavailable() : err;
        }
        const waitMs = err.retryAfterMs ?? Math.min(2_000 * 2 ** attempt, MAX_BACKOFF_MS);
        await sleep(Math.min(waitMs, MAX_BACKOFF_MS));
      }
    }
  }

  /** @param schemaInSystemPrompt fallback mode: use response_format json_object and paste the schema into the system prompt. */
  private async request(t: JsonTask, schemaInSystemPrompt: boolean): Promise<unknown> {
    const system = schemaInSystemPrompt
      ? `${t.system}\n\nRespond with ONLY a single JSON object matching this JSON Schema, with no prose and no markdown code fences:\n${JSON.stringify(t.jsonSchema)}`
      : t.system;

    const body = {
      model: this.info.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: t.user },
      ],
      max_tokens: t.maxTokens,
      temperature: 0,
      response_format: schemaInSystemPrompt
        ? { type: "json_object" }
        : { type: "json_schema", json_schema: { name: t.schemaName, strict: false, schema: t.jsonSchema } },
      ...(this.reasoningEffort ? { reasoning: { effort: this.reasoningEffort, exclude: true } } : {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Never logged: this header is only ever sent, never printed.
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmUnavailableError(`openai-compatible request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await safeText(res);
      if (!schemaInSystemPrompt && res.status === 400 && /response_format/i.test(text)) {
        throw new ResponseFormatRejectedError();
      }
      if (res.status === 429 || res.status === 502 || res.status === 503) {
        throw new RetryableStatusError(res.status, parseRetryAfter(res.headers.get("retry-after")), errorDetail(text));
      }
      throw new LlmUnavailableError(`openai-compatible API error (status ${res.status})${errorDetail(text)}`);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new LlmUnavailableError("openai-compatible response was not valid JSON.");
    }

    const content = extractMessageContent(data);
    if (content === null) {
      const finish = extractFinishReason(data);
      throw new LlmUnavailableError(
        finish === "length"
          ? "openai-compatible response ran out of tokens before answering (finish_reason: length). For reasoning models, set LLM_REASONING_EFFORT=low."
          : "openai-compatible response had no message content.",
      );
    }
    return parseJsonContent(content);
  }
}

function extractMessageContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function extractFinishReason(data: unknown): string | null {
  const choices = (data as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const reason = (choices[0] as { finish_reason?: unknown } | undefined)?.finish_reason;
  return typeof reason === "string" ? reason : null;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(stripCodeFences(content));
  } catch {
    throw new LlmUnavailableError("openai-compatible response content was not valid JSON.");
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
