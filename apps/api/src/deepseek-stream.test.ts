import { expect, it, vi } from "vitest";
import { readDeepSeekStream } from "./deepseek-stream.js";

const chunk = (content: string, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ id: "provider-1", model: "deepseek-v4-flash", choices: [{ index: 0, delta: { content }, finish_reason: null }], ...extra })}\r\n\r\n`;
const end =
  chunk("", {
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }) + "data: [DONE]\r\n\r\n";

it("exposes text before completion, preserving split UTF-8 and withholding reasoning", async () => {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        stream = controller;
      },
    }),
  );
  const onDelta = vi.fn();
  const result = readDeepSeekStream(response, new AbortController().signal, onDelta);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(
    chunk("中文😀", {
      choices: [
        {
          index: 0,
          delta: { content: "中文😀", reasoning_content: "secret" },
          finish_reason: null,
        },
      ],
    }),
  );
  for (const byte of bytes) stream?.enqueue(new Uint8Array([byte]));
  await vi.waitFor(() => expect(onDelta).toHaveBeenCalledWith("中文😀"));
  stream?.enqueue(encoder.encode(end));
  stream?.close();
  expect(await result).toEqual({
    content: "中文😀",
    usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 20 },
  });
  expect(JSON.stringify(onDelta.mock.calls)).not.toContain("secret");
});

it.each(["missing-terminal", "wrong-model", "truncated", "duplicate-terminal"])(
  "rejects %s streams without accepting partial success",
  async (fault) => {
    let content = chunk("data") + end;
    if (fault === "missing-terminal") content = chunk("data");
    if (fault === "wrong-model") content = content.replaceAll("deepseek-v4-flash", "wrong-model");
    if (fault === "truncated") content = content.replace('"stop"', '"length"');
    if (fault === "duplicate-terminal") content += end;
    await expect(
      readDeepSeekStream(new Response(content), new AbortController().signal, () => undefined),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^model_(response|output)_invalid$/) });
  },
);

it("aborts a stalled provider reader promptly", async () => {
  const controller = new AbortController();
  const pending = readDeepSeekStream(
    new Response(new ReadableStream({})),
    controller.signal,
    () => undefined,
  );
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "model_timeout" });
});
