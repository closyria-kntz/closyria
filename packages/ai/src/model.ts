import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { TokenUsage } from "./budget";

/** The light model that reads order e-mails (spec « Après la commande » §6). */
export const ORDER_EMAIL_MODEL = "claude-haiku-5-5";

/** One request to the model: instructions, the (already redacted) text, and the JSON shape of the answer. */
export type ModelRequest<T> = { system: string; text: string; maxTokens: number; output: z.ZodType<T> };
/**
 * The model's answer: `output` is the JSON it wrote (null when it refused or was cut), not yet validated; `usage`
 * what was billed. Throws `AiUnavailableError` when nothing was billed and the call may be tried later.
 */
export type ModelAnswer = { output: unknown; usage: TokenUsage };
export type StructuredModel = <T>(request: ModelRequest<T>) => Promise<ModelAnswer>;

/** The API refused or could not be reached (rate limit, overload, network): nothing billed, try again later. */
export class AiUnavailableError extends Error {
  override readonly name = "AiUnavailableError";
}

/** How long one call may take before it counts as unavailable (the SDK retries twice on its own). */
const TIMEOUT_MS = 60_000;

/**
 * The real model, through the official SDK and structured outputs (`output_config.format` from the Zod schema): the
 * API only writes JSON of that shape. Thinking is off and effort low: a short extraction.
 */
export function anthropicModel(apiKey: string, client = new Anthropic({ apiKey, timeout: TIMEOUT_MS })) {
  const model: StructuredModel = async (request) => {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: ORDER_EMAIL_MODEL,
        max_tokens: request.maxTokens,
        thinking: { type: "disabled" },
        output_config: { effort: "low", format: zodOutputFormat(request.output) },
        system: request.system,
        messages: [{ role: "user", content: request.text }],
      });
    } catch (error) {
      // A 4xx other than 408/409/429 is a mistake of ours: it surfaces as is, never retried forever.
      if (error instanceof Anthropic.APIConnectionError) throw new AiUnavailableError("model unreachable");
      if (error instanceof Anthropic.APIError && (error.status === 429 || (error.status ?? 0) >= 500)) {
        throw new AiUnavailableError(`model unavailable (${error.status})`);
      }
      throw error;
    }
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    let output: unknown = null;
    if (response.stop_reason === "end_turn") {
      try {
        output = JSON.parse(text);
      } catch {
        output = null;
      }
    }
    return { output, usage: response.usage };
  };
  return model;
}
