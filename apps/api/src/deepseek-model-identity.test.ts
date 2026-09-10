import { expect, it, vi } from "vitest";
import { parseDeepSeekAnalysisResponse } from "./deepseek-analysis-protocol.js";
import { readDeepSeekStream } from "./deepseek-stream.js";

const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
const expected = {
  content: "{}",
  usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 2 },
};

function stream(model: string): Response {
  const frame = (choices: unknown[], extra = {}) =>
    `data: ${JSON.stringify({ id: "response-id", model, choices, ...extra })}\n\n`;
  return new Response(
    frame([{ index: 0, delta: { content: "{}" }, finish_reason: null }]) +
      frame([{ index: 0, delta: {}, finish_reason: "stop" }], { usage }) +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}

function json(model: string): Response {
  return Response.json({
    id: "response-id",
    model,
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
    usage,
  });
}

it("accepts the current Flash stream model without losing content or usage", async () => {
  const diagnostic = vi.fn();
  await expect(
    readDeepSeekStream(
      stream("deepseek-flash"),
      new AbortController().signal,
      vi.fn(),
      vi.fn(),
      diagnostic,
    ),
  ).resolves.toEqual(expected);
  expect(diagnostic).not.toHaveBeenCalled();
});

it("accepts the same current Flash identity in a JSON response", async () => {
  await expect(
    parseDeepSeekAnalysisResponse(json("deepseek-flash"), new AbortController().signal),
  ).resolves.toEqual(expected);
});

it.each(["deepseek-v4-flash", "deepseek-v4-pro", "unrelated-model"])(
  "rejects an unexpected model %s",
  async (model) => {
    await expect(
      readDeepSeekStream(stream(model), new AbortController().signal, vi.fn(), vi.fn(), vi.fn()),
    ).rejects.toMatchObject({ code: "model_response_invalid" });
    await expect(
      parseDeepSeekAnalysisResponse(json(model), new AbortController().signal),
    ).rejects.toMatchObject({ code: "model_response_invalid" });
  },
);
