import { describe, expect, it } from "vitest";

import type { DeepSeekProviderError } from "./deepseek-provider-errors.js";
import {
  DeepSeekSseDecoder,
  MAXIMUM_DEEPSEEK_SSE_EVENT_BYTES,
  MAXIMUM_DEEPSEEK_SSE_STREAM_BYTES,
} from "./deepseek-sse-decoder.js";

const encoder = new TextEncoder();

function invalidResponse(action: () => unknown): void {
  expect(action).toThrowError(
    expect.objectContaining<Partial<DeepSeekProviderError>>({ code: "INVALID_RESPONSE" }),
  );
}

describe("DeepSeekSseDecoder", () => {
  it("reassembles UTF-8 data split at every byte and ignores keep-alive comments", () => {
    const decoder = new DeepSeekSseDecoder();
    const bytes = encoder.encode(': keep-alive\n\ndata: {"text":"翻译"}\n\n');
    const messages: string[] = [];

    for (const byte of bytes) messages.push(...decoder.push(Uint8Array.of(byte)));
    messages.push(...decoder.finish());

    expect(messages).toEqual(['{"text":"翻译"}']);
  });

  it("rejects incomplete, invalid UTF-8, unknown and oversized events", () => {
    const incomplete = new DeepSeekSseDecoder();
    incomplete.push(encoder.encode("data: unfinished"));
    invalidResponse(() => incomplete.finish());

    const invalidUtf8 = new DeepSeekSseDecoder();
    invalidResponse(() => invalidUtf8.push(Uint8Array.of(0xc3, 0x28)));

    const unknownField = new DeepSeekSseDecoder();
    invalidResponse(() => unknownField.push(encoder.encode("event: message\n\n")));

    const oversizedEvent = new DeepSeekSseDecoder();
    invalidResponse(() =>
      oversizedEvent.push(new Uint8Array(MAXIMUM_DEEPSEEK_SSE_EVENT_BYTES + 1)),
    );
  });

  it("rejects a stream above the global byte limit even across valid events", () => {
    const decoder = new DeepSeekSseDecoder();
    const event = encoder.encode(`data: ${"x".repeat(60_000)}\n\n`);
    let written = 0;

    while (written + event.byteLength <= MAXIMUM_DEEPSEEK_SSE_STREAM_BYTES) {
      decoder.push(event);
      written += event.byteLength;
    }

    invalidResponse(() => decoder.push(event));
  });
});
