import { endianness } from "node:os";

import { describe, expect, it } from "vitest";

import { MAX_WIRE_MESSAGE_BYTES } from "@huayi/protocol";

import { NativeMessageDecoder, encodeNativeMessage } from "./framing.js";

describe("encodeNativeMessage", () => {
  it("writes a native-endian 32-bit length followed by UTF-8 JSON", () => {
    const message = { requestId: "health-1", schemaVersion: 1, type: "health" };
    const frame = encodeNativeMessage(message);
    const payloadLength = endianness() === "LE" ? frame.readUInt32LE(0) : frame.readUInt32BE(0);

    expect(payloadLength).toBe(frame.length - 4);
    expect(JSON.parse(frame.subarray(4).toString("utf8"))).toEqual(message);
  });

  it("rejects messages larger than the wire limit", () => {
    expect(() => encodeNativeMessage({ value: "a".repeat(MAX_WIRE_MESSAGE_BYTES) })).toThrow(
      /too large/i,
    );
  });
});

describe("NativeMessageDecoder", () => {
  it("decodes partial chunks and multiple frames", () => {
    const decoder = new NativeMessageDecoder();
    const first = encodeNativeMessage({ type: "first" });
    const second = encodeNativeMessage({ type: "second" });

    expect(decoder.push(first.subarray(0, 3))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(3), second]))).toEqual([
      { type: "first" },
      { type: "second" },
    ]);
  });

  it("fails closed on zero, oversized, and invalid JSON frames", () => {
    const zeroLength = Buffer.alloc(4);
    const oversized = Buffer.alloc(4);
    const invalidJsonPayload = Buffer.from("not-json", "utf8");
    const invalidJson = Buffer.alloc(4 + invalidJsonPayload.length);

    if (endianness() === "LE") {
      oversized.writeUInt32LE(MAX_WIRE_MESSAGE_BYTES + 1, 0);
      invalidJson.writeUInt32LE(invalidJsonPayload.length, 0);
    } else {
      oversized.writeUInt32BE(MAX_WIRE_MESSAGE_BYTES + 1, 0);
      invalidJson.writeUInt32BE(invalidJsonPayload.length, 0);
    }
    invalidJsonPayload.copy(invalidJson, 4);

    expect(() => new NativeMessageDecoder().push(zeroLength)).toThrow(/length/i);
    expect(() => new NativeMessageDecoder().push(oversized)).toThrow(/too large/i);
    expect(() => new NativeMessageDecoder().push(invalidJson)).toThrow(/JSON/i);
  });
});
