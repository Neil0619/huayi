import { deepSeekProviderError } from "./deepseek-provider-errors.js";

export const MAXIMUM_DEEPSEEK_SSE_EVENT_BYTES = 64 * 1024;
export const MAXIMUM_DEEPSEEK_SSE_STREAM_BYTES = 2 * 1024 * 1024;

export class DeepSeekSseDecoder {
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  #dataLines: string[] = [];
  #eventBytes = 0;
  #finished = false;
  #lineLastByte = -1;
  #lineLength = 0;
  #textBuffer = "";
  #totalBytes = 0;

  push(chunk: Uint8Array): string[] {
    if (this.#finished) throw deepSeekProviderError("INVALID_RESPONSE");
    this.#countBytes(chunk);
    try {
      this.#textBuffer += this.#decoder.decode(chunk, { stream: true });
    } catch {
      throw deepSeekProviderError("INVALID_RESPONSE");
    }
    return this.#consumeLines();
  }

  finish(): string[] {
    if (this.#finished) throw deepSeekProviderError("INVALID_RESPONSE");
    this.#finished = true;
    try {
      this.#textBuffer += this.#decoder.decode();
    } catch {
      throw deepSeekProviderError("INVALID_RESPONSE");
    }
    const messages = this.#consumeLines();
    if (this.#textBuffer.length !== 0 || this.#dataLines.length !== 0 || this.#eventBytes !== 0) {
      throw deepSeekProviderError("INVALID_RESPONSE");
    }
    return messages;
  }

  #countBytes(chunk: Uint8Array): void {
    this.#totalBytes += chunk.byteLength;
    if (this.#totalBytes > MAXIMUM_DEEPSEEK_SSE_STREAM_BYTES) {
      throw deepSeekProviderError("INVALID_RESPONSE");
    }
    for (const byte of chunk) {
      this.#eventBytes += 1;
      if (this.#eventBytes > MAXIMUM_DEEPSEEK_SSE_EVENT_BYTES) {
        throw deepSeekProviderError("INVALID_RESPONSE");
      }
      if (byte === 0x0a) {
        const blankLine =
          this.#lineLength === 0 || (this.#lineLength === 1 && this.#lineLastByte === 0x0d);
        this.#lineLength = 0;
        this.#lineLastByte = -1;
        if (blankLine) this.#eventBytes = 0;
      } else {
        this.#lineLength += 1;
        this.#lineLastByte = byte;
      }
    }
  }

  #consumeLines(): string[] {
    const messages: string[] = [];
    let newline = this.#textBuffer.indexOf("\n");
    while (newline >= 0) {
      let line = this.#textBuffer.slice(0, newline);
      this.#textBuffer = this.#textBuffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.includes("\r")) throw deepSeekProviderError("INVALID_RESPONSE");
      const message = this.#consumeLine(line);
      if (message !== undefined) messages.push(message);
      newline = this.#textBuffer.indexOf("\n");
    }
    return messages;
  }

  #consumeLine(line: string): string | undefined {
    if (line === "") return this.#dispatch();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    if (colon < 0 || line.slice(0, colon) !== "data") {
      throw deepSeekProviderError("INVALID_RESPONSE");
    }
    const rawValue = line.slice(colon + 1);
    this.#dataLines.push(rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue);
    return undefined;
  }

  #dispatch(): string | undefined {
    if (this.#dataLines.length === 0) return undefined;
    const data = this.#dataLines.join("\n");
    this.#dataLines = [];
    return data;
  }
}
