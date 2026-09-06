import { expect, it, vi } from "vitest";
import { readDeepSeekStream } from "./deepseek-stream.js";

const encoder = new TextEncoder();
const event = (delta: Record<string, string> = {}, finish: string | null = null) =>
  `data: ${JSON.stringify({
    id: "provider-stream-" + "a".repeat(120),
    object: "chat.completion.chunk",
    created: 1_788_659_700,
    model: "deepseek-v4-flash",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(finish
      ? { usage: { prompt_tokens: 10, completion_tokens: 8192, total_tokens: 8202 } }
      : {}),
  })}\n\n`;
const terminal = event({}, "stop") + "data: [DONE]\n\n";
const response = (parts: string[], size?: number) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) {
          const bytes = encoder.encode(part);
          if (size) {
            for (let start = 0; start < bytes.length; start += size)
              controller.enqueue(bytes.slice(start, start + size));
          } else controller.enqueue(bytes);
        }
        controller.close();
      },
    }),
  );

it.each([undefined, 8192])(
  "accepts a complete thinking stream above 2 MiB with chunk size %s without exposing reasoning",
  async (size) => {
    const reasoning = event({ reasoning_content: "private" }).repeat(8190);
    expect(encoder.encode(reasoning).byteLength).toBeGreaterThan(2 * 1024 * 1024);
    expect(encoder.encode(reasoning).byteLength).toBeLessThan(8 * 1024 * 1024);
    const onDelta = vi.fn();
    const diagnostic = vi.fn();
    const result = await readDeepSeekStream(
      response([reasoning, event({ content: "可展示的结果" }), terminal], size),
      new AbortController().signal,
      onDelta,
      vi.fn(),
      diagnostic,
    );
    expect(result).toEqual({
      content: "可展示的结果",
      usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 8192 },
    });
    expect(onDelta.mock.calls).toEqual([["可展示的结果"]]);
    expect(diagnostic).not.toHaveBeenCalled();
  },
);

it("keeps a finite 8 MiB wire bound and cancels a provider that exceeds it", async () => {
  const cancel = vi.fn();
  const diagnostic = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
    },
    cancel,
  });
  await expect(
    readDeepSeekStream(
      new Response(body),
      new AbortController().signal,
      vi.fn(),
      vi.fn(),
      diagnostic,
    ),
  ).rejects.toMatchObject({ code: "model_response_invalid" });
  expect(diagnostic).toHaveBeenCalledWith({ event: "deepseek_stream_failed", stage: "wire-limit" });
  expect(cancel).toHaveBeenCalledOnce();
});

it.each([undefined, 8192])(
  "rejects an oversized complete frame with chunk size %s",
  async (size) => {
    const onDelta = vi.fn();
    const diagnostic = vi.fn();
    await expect(
      readDeepSeekStream(
        response([event({ content: "x".repeat(65_536) }), terminal], size),
        new AbortController().signal,
        onDelta,
        vi.fn(),
        diagnostic,
      ),
    ).rejects.toMatchObject({ code: "model_response_invalid" });
    expect(onDelta).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith({
      event: "deepseek_stream_failed",
      stage: "frame-limit",
    });
  },
);

it("bounds a multi-line data frame even when every line fits", async () => {
  const diagnostic = vi.fn();
  await expect(
    readDeepSeekStream(
      response([("data: " + " ".repeat(32_000) + "\n").repeat(3) + "\n"]),
      new AbortController().signal,
      vi.fn(),
      vi.fn(),
      diagnostic,
    ),
  ).rejects.toMatchObject({ code: "model_response_invalid" });
  expect(diagnostic).toHaveBeenCalledWith({
    event: "deepseek_stream_failed",
    stage: "frame-limit",
  });
});

it("bounds retained answer text independently of wire overhead", async () => {
  const diagnostic = vi.fn();
  const onDelta = vi.fn();
  const content = "a".repeat(32_768);
  await expect(
    readDeepSeekStream(
      response([event({ content }).repeat(33), terminal]),
      new AbortController().signal,
      onDelta,
      vi.fn(),
      diagnostic,
    ),
  ).rejects.toMatchObject({ code: "model_response_invalid" });
  expect(onDelta.mock.calls.map(([text]) => text as string).join("").length).toBe(1024 * 1024);
  expect(diagnostic).toHaveBeenCalledWith({
    event: "deepseek_stream_failed",
    stage: "content-limit",
  });
});
