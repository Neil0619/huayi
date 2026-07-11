import { endianness } from "node:os";

import { MAX_WIRE_MESSAGE_BYTES } from "@huayi/protocol";

const HEADER_LENGTH = 4;
const EMPTY_BUFFER = Buffer.alloc(0);

export class NativeFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeFrameError";
  }
}

function readPayloadLength(buffer: Buffer): number {
  return endianness() === "LE" ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
}

function writePayloadLength(buffer: Buffer, length: number): void {
  if (endianness() === "LE") {
    buffer.writeUInt32LE(length, 0);
  } else {
    buffer.writeUInt32BE(length, 0);
  }
}

function validatePayloadLength(length: number): void {
  if (length === 0) {
    throw new NativeFrameError("Native message length must be greater than zero.");
  }
  if (length > MAX_WIRE_MESSAGE_BYTES) {
    throw new NativeFrameError("Native message is too large.");
  }
}

export function encodeNativeMessage(message: unknown): Buffer {
  const json = JSON.stringify(message);
  if (json === undefined) {
    throw new NativeFrameError("Native message is not JSON serializable.");
  }

  const payload = Buffer.from(json, "utf8");
  validatePayloadLength(payload.length);
  const frame = Buffer.allocUnsafe(HEADER_LENGTH + payload.length);
  writePayloadLength(frame, payload.length);
  payload.copy(frame, HEADER_LENGTH);
  return frame;
}

export class NativeMessageDecoder {
  private buffered = EMPTY_BUFFER;

  push(chunk: Uint8Array): unknown[] {
    this.buffered = Buffer.concat([this.buffered, Buffer.from(chunk)]);
    const messages: unknown[] = [];

    try {
      while (this.buffered.length >= HEADER_LENGTH) {
        const payloadLength = readPayloadLength(this.buffered);
        validatePayloadLength(payloadLength);
        const frameLength = HEADER_LENGTH + payloadLength;
        if (this.buffered.length < frameLength) {
          break;
        }

        const payload = this.buffered.subarray(HEADER_LENGTH, frameLength).toString("utf8");
        try {
          messages.push(JSON.parse(payload) as unknown);
        } catch {
          throw new NativeFrameError("Native message contains invalid JSON.");
        }
        this.buffered = this.buffered.subarray(frameLength);
      }
    } catch (error) {
      this.buffered = EMPTY_BUFFER;
      throw error;
    }

    return messages;
  }
}
