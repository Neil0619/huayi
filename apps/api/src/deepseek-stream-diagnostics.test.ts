import { afterEach, expect, it, vi } from "vitest";
import { DeepSeekAnalysisModelError } from "./deepseek-provider-error.js";
import { readDeepSeekStream } from "./deepseek-stream.js";

const secret = "private source reasoning key header id error unknown-field";
const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
const receipt = { cachedInputTokens: 0, inputTokens: 10, outputTokens: 20 };
const event = (extra: Record<string, unknown> = {}) => ({
  id: secret,
  model: "deepseek-v4-flash",
  choices: [{ index: 0, delta: { content: secret }, finish_reason: null }],
  ...extra,
});
const frame = (extra: Record<string, unknown> = {}) => `data: ${JSON.stringify(event(extra))}\n\n`;
const finished = frame({
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  usage,
});
const done = "data: [DONE]\n\n";
const controller = () => new AbortController();
const read = (response: Pick<Response, "body">, sink = vi.fn()) =>
  readDeepSeekStream(response, controller().signal, vi.fn(), vi.fn(), sink);

afterEach(() => vi.restoreAllMocks());

it.each([
  ["missing-body", () => new Response(null)],
  ["wire-limit", () => new Response(new Uint8Array(8 * 1024 * 1024 + 1))],
  ["frame-limit", () => new Response(`data: ${"x".repeat(65_536)}`)],
  ["utf8", () => new Response(new Uint8Array([0xff]))],
  ["sse-line", () => new Response(`${secret}\n\n`)],
  ["frame-json", () => new Response(`data: {${secret}\n\n`)],
  ["frame-schema", () => new Response(frame({ model: secret }))],
  ["stream-identity", () => new Response(frame() + frame({ id: "other-private-id" }))],
  ["usage", () => new Response(frame({ usage: { ...usage, [secret]: secret } }))],
  ["after-done", () => new Response(frame() + finished + done + frame())],
  ["after-finish", () => new Response(frame() + finished + frame())],
  ["incomplete-terminal", () => new Response(frame() + finished)],
] as const)("reports only the fixed %s stage once", async (stage, response) => {
  const sink = vi.fn();
  await expect(read(response(), sink)).rejects.toMatchObject({ code: "model_response_invalid" });
  expect(sink.mock.calls).toEqual([[{ event: "deepseek_stream_failed", stage }]]);
  expect(JSON.stringify(sink.mock.calls)).not.toContain(secret);
});

it("reports a non-stop finish without logging its untrusted reason or losing usage", async () => {
  const sink = vi.fn();
  await expect(
    read(
      new Response(
        frame({
          choices: [{ index: 0, delta: { content: secret }, finish_reason: secret }],
          usage,
        }) + done,
      ),
      sink,
    ),
  ).rejects.toMatchObject({ code: "model_output_invalid", usage: receipt });
  expect(sink.mock.calls).toEqual([
    [{ event: "deepseek_stream_failed", stage: "non-stop-finish" }],
  ]);
});

it("never logs unknown schema field names or values, including nested deltas", async () => {
  const sink = vi.fn();
  await expect(
    read(
      new Response(
        frame({ choices: [{ index: 0, delta: { [secret]: secret }, finish_reason: null }] }),
      ),
      sink,
    ),
  ).rejects.toMatchObject({ code: "model_response_invalid" });
  expect(sink.mock.calls).toEqual([[{ event: "deepseek_stream_failed", stage: "frame-schema" }]]);
});

it("never logs a reader error message or its properties", async () => {
  const sink = vi.fn();
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.error(Object.assign(new Error(secret), { [secret]: secret }));
      },
    }),
  );
  await expect(read(response, sink)).rejects.toMatchObject({ code: "model_response_invalid" });
  expect(sink.mock.calls).toEqual([[{ event: "deepseek_stream_failed", stage: "read" }]]);
});

it("uses console.warn by default with only the fixed event and stage", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await expect(
    readDeepSeekStream(new Response(frame()), controller().signal, vi.fn()),
  ).rejects.toMatchObject({ code: "model_response_invalid" });
  expect(warn.mock.calls).toEqual([
    [{ event: "deepseek_stream_failed", stage: "incomplete-terminal" }],
  ]);
});

it.each([
  ["frame-json", `data: {${secret}\n\n`],
  ["usage", frame({ usage: { ...usage, total_tokens: 31 } })],
  ["incomplete-terminal", ""],
  ["wire-limit", "x".repeat(8 * 1024 * 1024 + 1)],
] as const)("preserves %s failure and known usage when the sink throws", async (stage, tail) => {
  const response = () =>
    new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(frame() + finished));
          stream.enqueue(new TextEncoder().encode(tail));
          stream.close();
        },
      }),
    );
  const original = await read(response()).catch((error: unknown) => error);
  const sink = vi.fn(() => {
    throw new Error(secret);
  });
  const withBrokenSink = await read(response(), sink).catch((error: unknown) => error);
  expect(original).toMatchObject({ code: "model_response_invalid", usage: receipt });
  expect(withBrokenSink).toMatchObject({ code: "model_response_invalid", usage: receipt });
  expect(withBrokenSink).toEqual(original);
  expect(sink.mock.calls).toEqual([[{ event: "deepseek_stream_failed", stage }]]);
});

it("keeps decoder flush failures distinct from incomplete terminal events", async () => {
  const sink = vi.fn();
  await expect(read(new Response(new Uint8Array([0xe4])), sink)).rejects.toMatchObject({
    code: "model_response_invalid",
  });
  expect(sink.mock.calls).toEqual([[{ event: "deepseek_stream_failed", stage: "utf8" }]]);
});

it("preserves reader acquisition errors even with a throwing default logger", async () => {
  const response = new Response(frame());
  const lock = response.body?.getReader();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {
    throw new Error(secret);
  });
  try {
    await expect(readDeepSeekStream(response, controller().signal, vi.fn())).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(warn.mock.calls).toEqual([[{ event: "deepseek_stream_failed", stage: "read" }]]);
  } finally {
    lock?.releaseLock();
  }
});

it("does not warn when the reader reports model_timeout without an aborted signal", async () => {
  const sink = vi.fn();
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.error(new DeepSeekAnalysisModelError("model_timeout"));
      },
    }),
  );
  await expect(read(response, sink)).rejects.toMatchObject({ code: "model_timeout" });
  expect(sink).not.toHaveBeenCalled();
});

it.each(["delta", "token"])(
  "does not mislabel consumer %s errors as parser errors",
  async (callback) => {
    const sink = vi.fn();
    const fail = () => {
      throw new Error(secret);
    };
    await expect(
      readDeepSeekStream(
        new Response(frame({ usage }) + finished + done),
        controller().signal,
        callback === "delta" ? fail : vi.fn(),
        callback === "token" ? fail : vi.fn(),
        sink,
      ),
    ).rejects.toMatchObject({ code: "model_response_invalid", usage: receipt });
    expect(sink).not.toHaveBeenCalled();
  },
);

it("does not warn or call a throwing diagnostic sink on success", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const sink = vi.fn(() => {
    throw new Error(secret);
  });
  await expect(read(new Response(frame() + finished + done), sink)).resolves.toEqual({
    content: secret,
    usage: receipt,
  });
  await expect(
    readDeepSeekStream(new Response(frame() + finished + done), controller().signal, vi.fn()),
  ).resolves.toEqual({ content: secret, usage: receipt });
  expect(sink).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});

it("does not warn on timeout or cancellation and retains known usage", async () => {
  const abort = controller();
  const sink = vi.fn();
  const token = vi.fn();
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(frame({ usage })));
      },
    }),
  );
  const result = readDeepSeekStream(response, abort.signal, vi.fn(), token, sink);
  await vi.waitFor(() => expect(token).toHaveBeenCalledOnce());
  abort.abort(new Error(secret));
  await expect(result).rejects.toMatchObject({ code: "model_timeout", usage: receipt });
  expect(sink).not.toHaveBeenCalled();
});
