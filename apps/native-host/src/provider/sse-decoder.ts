import { openAIProviderError } from "./openai-provider-errors.js";

export const MAXIMUM_SSE_EVENT_BYTES = 64 * 1024;
export const MAXIMUM_SSE_STREAM_BYTES = 2 * 1024 * 1024;

export interface SseMessage {
  data: string;
  event: string;
}

export class SseDecoder {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private dataLines: string[] = [];
  private eventBytes = 0;
  private eventName: string | undefined;
  private finished = false;
  private lineLength = 0;
  private lineLastByte = -1;
  private textBuffer = "";
  private totalBytes = 0;

  push(chunk: Uint8Array): SseMessage[] {
    if (this.finished) {
      throw openAIProviderError("INVALID_RESPONSE");
    }
    this.countBytes(chunk);
    try {
      this.textBuffer += this.decoder.decode(chunk, { stream: true });
    } catch (error) {
      throw openAIProviderError("INVALID_RESPONSE", error);
    }
    return this.consumeLines();
  }

  finish(): SseMessage[] {
    if (this.finished) {
      throw openAIProviderError("INVALID_RESPONSE");
    }
    this.finished = true;
    try {
      this.textBuffer += this.decoder.decode();
    } catch (error) {
      throw openAIProviderError("INVALID_RESPONSE", error);
    }
    const messages = this.consumeLines();
    if (
      this.textBuffer.length !== 0 ||
      this.eventName !== undefined ||
      this.dataLines.length !== 0 ||
      this.eventBytes !== 0
    ) {
      throw openAIProviderError("INVALID_RESPONSE");
    }
    return messages;
  }

  private countBytes(chunk: Uint8Array): void {
    this.totalBytes += chunk.byteLength;
    if (this.totalBytes > MAXIMUM_SSE_STREAM_BYTES) {
      throw openAIProviderError("INVALID_RESPONSE");
    }

    for (const byte of chunk) {
      this.eventBytes += 1;
      if (this.eventBytes > MAXIMUM_SSE_EVENT_BYTES) {
        throw openAIProviderError("INVALID_RESPONSE");
      }
      if (byte === 0x0a) {
        const blankLine =
          this.lineLength === 0 || (this.lineLength === 1 && this.lineLastByte === 0x0d);
        this.lineLength = 0;
        this.lineLastByte = -1;
        if (blankLine) {
          this.eventBytes = 0;
        }
      } else {
        this.lineLength += 1;
        this.lineLastByte = byte;
      }
    }
  }

  private consumeLines(): SseMessage[] {
    const messages: SseMessage[] = [];
    let newline = this.textBuffer.indexOf("\n");
    while (newline >= 0) {
      let line = this.textBuffer.slice(0, newline);
      this.textBuffer = this.textBuffer.slice(newline + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      if (line.includes("\r")) {
        throw openAIProviderError("INVALID_RESPONSE");
      }
      const message = this.consumeLine(line);
      if (message !== undefined) {
        messages.push(message);
      }
      newline = this.textBuffer.indexOf("\n");
    }
    return messages;
  }

  private consumeLine(line: string): SseMessage | undefined {
    if (line === "") {
      return this.dispatch();
    }
    if (line.startsWith(":")) {
      return undefined;
    }

    const colon = line.indexOf(":");
    if (colon < 0) {
      throw openAIProviderError("INVALID_RESPONSE");
    }
    const field = line.slice(0, colon);
    const rawValue = line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") {
      if (this.eventName !== undefined || value.length === 0) {
        throw openAIProviderError("INVALID_RESPONSE");
      }
      this.eventName = value;
      return undefined;
    }
    if (field === "data") {
      this.dataLines.push(value);
      return undefined;
    }
    throw openAIProviderError("INVALID_RESPONSE");
  }

  private dispatch(): SseMessage | undefined {
    if (this.eventName === undefined && this.dataLines.length === 0) {
      return undefined;
    }
    if (this.eventName === undefined || this.dataLines.length === 0) {
      throw openAIProviderError("INVALID_RESPONSE");
    }
    const message = { data: this.dataLines.join("\n"), event: this.eventName };
    this.eventName = undefined;
    this.dataLines = [];
    return message;
  }
}
