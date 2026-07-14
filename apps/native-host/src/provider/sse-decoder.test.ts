import { describe, expect, it } from "vitest";

import { MAXIMUM_SSE_EVENT_BYTES, MAXIMUM_SSE_STREAM_BYTES, SseDecoder } from "./sse-decoder.js";

const encoder = new TextEncoder();

function decode(source: string): ReturnType<SseDecoder["finish"]> {
  const decoder = new SseDecoder();
  return [...decoder.push(encoder.encode(source)), ...decoder.finish()];
}

function eventWithRawByteLength(length: number): Uint8Array {
  const prefix = "event: x\ndata: ";
  const suffix = "\n\n";
  return encoder.encode(`${prefix}${"x".repeat(length - prefix.length - suffix.length)}${suffix}`);
}

describe("SseDecoder", () => {
  it("decodes CRLF input at every raw byte split, including inside UTF-8", () => {
    const source = encoder.encode(
      "event: response.output_text.delta\r\n" +
        'data: {"type":"response.output_text.delta","delta":"你"}\r\n\r\n',
    );

    for (let split = 0; split <= source.length; split += 1) {
      const decoder = new SseDecoder();
      expect([
        ...decoder.push(source.slice(0, split)),
        ...decoder.push(source.slice(split)),
        ...decoder.finish(),
      ]).toEqual([
        {
          data: '{"type":"response.output_text.delta","delta":"你"}',
          event: "response.output_text.delta",
        },
      ]);
    }
  });

  it("joins multiple data lines with line feeds and ignores comments", () => {
    expect(decode(": keepalive\ndata: first\ndata: second\nevent: example\n\n")).toEqual([
      { data: "first\nsecond", event: "example" },
    ]);
  });

  it("accepts LF and CRLF event terminators", () => {
    expect(decode("event: first\ndata: one\n\nevent: second\r\ndata: two\r\n\r\n")).toEqual([
      { data: "one", event: "first" },
      { data: "two", event: "second" },
    ]);
  });

  it("removes at most one optional space after a field colon", () => {
    expect(decode("event: example\ndata:  indented\n\n")).toEqual([
      { data: " indented", event: "example" },
    ]);
  });

  it("accepts comment-only keepalive frames without emitting a message", () => {
    expect(decode(": keepalive\n\n:second\r\n\r\n")).toEqual([]);
  });

  it.each(["id: 1", "retry: 1000", "unknown: value"])(
    "rejects the unsupported SSE field %s",
    (field) => {
      const decoder = new SseDecoder();
      expect(() => decoder.push(encoder.encode(`${field}\n\n`))).toThrowError(
        expect.objectContaining({ code: "INVALID_RESPONSE" }),
      );
    },
  );

  it("rejects duplicate event fields", () => {
    const decoder = new SseDecoder();
    expect(() =>
      decoder.push(encoder.encode("event: first\nevent: second\ndata: value\n\n")),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });

  it("rejects a data frame without an event field", () => {
    const decoder = new SseDecoder();
    expect(() => decoder.push(encoder.encode("data: value\n\n"))).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
  });

  it("rejects an event frame without a data field", () => {
    const decoder = new SseDecoder();
    expect(() => decoder.push(encoder.encode("event: example\n\n"))).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
  });

  it("rejects invalid and truncated UTF-8", () => {
    const invalid = new SseDecoder();
    expect(() => invalid.push(Uint8Array.of(0xc3, 0x28))).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );

    const truncated = new SseDecoder();
    truncated.push(Uint8Array.of(0xc3));
    expect(() => truncated.finish()).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
  });

  it("rejects a final event that lacks a blank-line terminator", () => {
    const decoder = new SseDecoder();
    decoder.push(encoder.encode("event: example\ndata: value\n"));

    expect(() => decoder.finish()).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
  });

  it("accepts exactly 64 KiB for one raw event and rejects one byte more", () => {
    const boundary = eventWithRawByteLength(MAXIMUM_SSE_EVENT_BYTES);
    expect(boundary.byteLength).toBe(64 * 1024);
    const decoder = new SseDecoder();
    expect(decoder.push(boundary)).toHaveLength(1);
    expect(decoder.finish()).toEqual([]);

    const oversized = new SseDecoder();
    expect(() => oversized.push(eventWithRawByteLength(MAXIMUM_SSE_EVENT_BYTES + 1))).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
  });

  it("accepts exactly 2 MiB across frames and rejects one byte more", () => {
    const frame = encoder.encode(`:${"x".repeat(1_021)}\n\n`);
    expect(frame.byteLength).toBe(1_024);
    const source = new Uint8Array(MAXIMUM_SSE_STREAM_BYTES);
    for (let offset = 0; offset < source.byteLength; offset += frame.byteLength) {
      source.set(frame, offset);
    }

    const decoder = new SseDecoder();
    expect(decoder.push(source)).toEqual([]);
    expect(() => decoder.push(Uint8Array.of(0x3a))).toThrowError(
      expect.objectContaining({ code: "INVALID_RESPONSE" }),
    );
  });
});
