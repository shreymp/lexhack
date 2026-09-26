// Anthropic provider: forces a single tool call to get schema-shaped JSON back.
import Anthropic from "@anthropic-ai/sdk";
import { LlmUnavailableError, type JsonTask, type LlmProvider } from "@/lib/llm/types";
import type { ProviderInfo } from "@/lib/types";

// Generous but bounded: batches are small (ANALYZE_BATCH_SIZE clauses) and the
// SDK's own retry logic (max_retries, default 2) runs inside this budget.
const REQUEST_TIMEOUT_MS = 60_000;

export class AnthropicProvider implements LlmProvider {
  readonly info: ProviderInfo;
  private readonly client: Anthropic;

  constructor(model: string) {
    this.info = { name: "anthropic", model, is_mock: false };
    // new Anthropic() with no apiKey reads ANTHROPIC_API_KEY from the environment.
    // We never read or log the key ourselves.
    this.client = new Anthropic({ timeout: REQUEST_TIMEOUT_MS });
  }

  async completeJson(t: JsonTask): Promise<unknown> {
    try {
      const response = await this.client.messages.create({
        model: this.info.model,
        max_tokens: t.maxTokens,
        system: t.system,
        messages: [{ role: "user", content: t.user }],
        tools: [
          {
            name: t.schemaName,
            description: `Return the result as structured JSON matching the required schema. Always call this tool exactly once with the full answer.`,
            input_schema: t.jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: t.schemaName },
      });

      if (response.stop_reason === "refusal") {
        throw new LlmUnavailableError("The model declined to respond (policy refusal).");
      }

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use" && block.name === t.schemaName,
      );
      if (!toolUse) {
        throw new LlmUnavailableError(
          `Anthropic response did not include the expected "${t.schemaName}" tool call (stop_reason: ${response.stop_reason}).`,
        );
      }
      return toolUse.input;
    } catch (err) {
      if (err instanceof LlmUnavailableError) throw err;
      if (err instanceof Anthropic.APIError) {
        // err.message from the SDK is derived from the HTTP response body and
        // never contains the request's Authorization header / API key.
        throw new LlmUnavailableError(`Anthropic API error (status ${err.status ?? "unknown"}): ${err.message}`, {
          cause: err,
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmUnavailableError(`Anthropic request failed: ${message}`, { cause: err });
    }
  }
}
