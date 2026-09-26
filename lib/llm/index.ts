// Chooses the LLM provider from environment configuration. Never logs keys.
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { OpenAiCompatibleProvider } from "@/lib/llm/openai-compatible";
import { MockProvider } from "@/lib/llm/mock";
import type { LlmProvider } from "@/lib/llm/types";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

type ProviderKind = "anthropic" | "openai-compatible" | "mock";

function readProviderKind(): ProviderKind | undefined {
  const raw = process.env.LLM_PROVIDER;
  if (raw === "anthropic" || raw === "openai-compatible" || raw === "mock") return raw;
  return undefined;
}

function buildAnthropic(): LlmProvider {
  const model = process.env.LLM_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  return new AnthropicProvider(model);
}

function buildOpenAiCompatible(): LlmProvider {
  const model = process.env.LLM_MODEL;
  if (!model) {
    throw new Error(
      "LLM_MODEL must be set when LLM_PROVIDER=openai-compatible (there is no default model for this provider).",
    );
  }
  const apiKey = process.env.OPENAI_COMPAT_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_COMPAT_API_KEY must be set when LLM_PROVIDER=openai-compatible.");
  }
  return new OpenAiCompatibleProvider(model, apiKey, process.env.OPENAI_COMPAT_BASE_URL);
}

/**
 * Resolves which LLM provider to use for this process.
 * Explicit LLM_PROVIDER wins; otherwise infer from whichever credential is set;
 * falls back to the offline mock provider when neither is configured.
 */
export function getProvider(): LlmProvider {
  const kind = readProviderKind();

  if (kind === "anthropic") return buildAnthropic();
  if (kind === "openai-compatible") return buildOpenAiCompatible();
  if (kind === "mock") return new MockProvider();

  if (process.env.ANTHROPIC_API_KEY) return buildAnthropic();
  if (process.env.OPENAI_COMPAT_API_KEY) return buildOpenAiCompatible();
  return new MockProvider();
}
