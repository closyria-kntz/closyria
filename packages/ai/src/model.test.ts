import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiUnavailableError, anthropicModel, ORDER_EMAIL_MODEL } from "./model";

const usage = { input_tokens: 10, output_tokens: 5 };
const request = { system: "s", text: "t", maxTokens: 100, output: z.object({ ok: z.boolean() }) };

/** The SDK client with `messages.create` replaced: no network. */
function fakeClient(create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<unknown>) {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = new Anthropic({ apiKey: "test-key" });
  Object.defineProperty(client, "messages", {
    value: {
      create: (params: Anthropic.MessageCreateParamsNonStreaming) => {
        sent.push(params);
        return create(params);
      },
    },
  });
  return { client, sent };
}

const reply =
  (text: string, stop_reason = "end_turn") =>
  async () => ({
    content: [{ type: "text", text }],
    stop_reason,
    usage,
  });

describe("anthropicModel", () => {
  it("asks Haiku 5.5 for the schema's JSON, thinking off, and returns it with the usage", async () => {
    const { client, sent } = fakeClient(reply('{"ok":true}'));
    const answer = await anthropicModel("test-key", client)(request);
    expect(answer).toEqual({ output: { ok: true }, usage });
    expect(sent[0]).toMatchObject({
      model: ORDER_EMAIL_MODEL,
      max_tokens: 100,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema" } },
      system: "s",
      messages: [{ role: "user", content: "t" }],
    });
    expect(ORDER_EMAIL_MODEL).toBe("claude-haiku-5-5");
  });

  it("gives no output for a refusal, a cut answer or broken JSON, still with the usage", async () => {
    for (const [text, stop] of [
      ['{"ok":true}', "refusal"],
      ['{"ok":', "max_tokens"],
      ["not json", "end_turn"],
    ] as const) {
      const { client } = fakeClient(reply(text, stop));
      expect(await anthropicModel("test-key", client)(request)).toEqual({ output: null, usage });
    }
  });

  it("turns a busy or unreachable API into AiUnavailableError, and lets our own mistakes through", async () => {
    const busy = fakeClient(async () => {
      throw new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", new Headers());
    });
    await expect(anthropicModel("k", busy.client)(request)).rejects.toBeInstanceOf(AiUnavailableError);
    const limited = fakeClient(async () => {
      throw new Anthropic.RateLimitError(429, { type: "error" }, "slow down", new Headers());
    });
    await expect(anthropicModel("k", limited.client)(request)).rejects.toBeInstanceOf(AiUnavailableError);
    const offline = fakeClient(async () => {
      throw new Anthropic.APIConnectionError({ message: "offline" });
    });
    await expect(anthropicModel("k", offline.client)(request)).rejects.toBeInstanceOf(AiUnavailableError);
    const wrong = fakeClient(async () => {
      throw new Anthropic.BadRequestError(400, { type: "error" }, "bad", new Headers());
    });
    await expect(anthropicModel("k", wrong.client)(request)).rejects.toBeInstanceOf(Anthropic.BadRequestError);
  });
});
