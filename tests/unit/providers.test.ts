import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "@/lib/llm";
import { OpenAiCompatibleProvider } from "@/lib/llm/openai-compatible";
import type { JsonTask } from "@/lib/llm/types";

const ENV_KEYS = [
  "LLM_PROVIDER",
  "LLM_MODEL",
  "ANTHROPIC_API_KEY",
  "OPENAI_COMPAT_API_KEY",
  "OPENAI_COMPAT_BASE_URL",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

describe("getProvider (env selection, no network)", () => {
  it("defaults to the mock provider when nothing is configured", () => {
    const provider = getProvider();
    expect(provider.info.name).toBe("mock");
    expect(provider.info.is_mock).toBe(true);
  });

  it("picks anthropic when only ANTHROPIC_API_KEY is set, defaulting the model", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    const provider = getProvider();
    expect(provider.info.name).toBe("anthropic");
    expect(provider.info.model).toBe("claude-sonnet-5");
  });

  it("respects LLM_MODEL for anthropic", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    process.env.LLM_MODEL = "claude-opus-5";
    const provider = getProvider();
    expect(provider.info.model).toBe("claude-opus-5");
  });

  it("picks openai-compatible when only its key is set (and LLM_MODEL is present)", () => {
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.LLM_MODEL = "some/model";
    const provider = getProvider();
    expect(provider.info.name).toBe("openai-compatible");
    expect(provider.info.model).toBe("some/model");
  });

  it("LLM_PROVIDER explicitly wins over available keys", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    process.env.LLM_PROVIDER = "mock";
    const provider = getProvider();
    expect(provider.info.name).toBe("mock");
  });

  it("throws a clear config error for openai-compatible with no LLM_MODEL", () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    expect(() => getProvider()).toThrow(/LLM_MODEL/);
  });

  it("throws a clear config error for openai-compatible with no API key", () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_MODEL = "some/model";
    expect(() => getProvider()).toThrow(/OPENAI_COMPAT_API_KEY/);
  });
});

function makeTask(overrides: Partial<JsonTask> = {}): JsonTask {
  return {
    task: "analyze_batch",
    system: "system prompt",
    user: "user prompt",
    schemaName: "test_schema",
    jsonSchema: { type: "object", properties: {}, required: [] },
    maxTokens: 256,
    payload: {},
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenAiCompatibleProvider (fetch mocked, no network)", () => {
  it("parses JSON content wrapped in markdown code fences", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        choices: [{ message: { content: '```json\n{"hello":"world"}\n```' } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiCompatibleProvider("some/model", "test-key");
    const result = await provider.completeJson(makeTask());

    expect(result).toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-key");
  });

  it("retries once with json_object + inlined schema when response_format is rejected", async () => {
    let call = 0;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      call++;
      if (call === 1) {
        return jsonResponse({ error: { message: "Invalid parameter: 'response_format' is not supported" } }, 400);
      }
      return jsonResponse({ choices: [{ message: { content: "{\"ok\":true}" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiCompatibleProvider("some/model", "test-key", "https://example.com/v1");
    const result = await provider.completeJson(makeTask());

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(firstBody.response_format.type).toBe("json_schema");

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody.response_format.type).toBe("json_object");
    expect(secondBody.messages[0].content).toContain("JSON Schema");
  });

  it("throws LlmUnavailableError (without leaking the API key) on a non-response_format error", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ error: "server exploded" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiCompatibleProvider("some/model", "super-secret-key");
    let caught: unknown;
    try {
      await provider.completeJson(makeTask());
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/status 500/);
    expect(message).not.toContain("super-secret-key");
  });
});
