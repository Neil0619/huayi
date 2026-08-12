import { BrowserAnalysisError } from "./analysis-error.js";

export interface SseMessage {
  readonly data: string;
  readonly event?: string;
}

export interface SseLimits {
  readonly eventBytes: number;
  readonly totalBytes: number;
}

export class BoundedSseDecoder {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private readonly dataLines: string[] = [];
  private eventName: string | undefined;
  private eventBytes = 0;
  private lineLastByte = -1;
  private lineLength = 0;
  private text = "";
  private totalBytes = 0;
  private finished = false;

  constructor(private readonly limits: SseLimits) {}

  push(chunk: Uint8Array): SseMessage[] {
    if (this.finished) throw new BrowserAnalysisError("invalid-response");
    this.countBytes(chunk);
    try {
      this.text += this.decoder.decode(chunk, { stream: true });
    } catch {
      throw new BrowserAnalysisError("invalid-response");
    }
    return this.consumeLines();
  }

  private countBytes(chunk: Uint8Array): void {
    this.totalBytes += chunk.byteLength;
    if (this.totalBytes > this.limits.totalBytes) {
      throw new BrowserAnalysisError("invalid-response");
    }
    for (const byte of chunk) {
      this.eventBytes += 1;
      if (this.eventBytes > this.limits.eventBytes) {
        throw new BrowserAnalysisError("invalid-response");
      }
      if (byte === 0x0a) {
        const isBlank =
          this.lineLength === 0 || (this.lineLength === 1 && this.lineLastByte === 0x0d);
        this.lineLength = 0;
        this.lineLastByte = -1;
        if (isBlank) this.eventBytes = 0;
      } else {
        this.lineLength += 1;
        this.lineLastByte = byte;
      }
    }
  }

  finish(): SseMessage[] {
    if (this.finished) throw new BrowserAnalysisError("invalid-response");
    this.finished = true;
    try {
      this.text += this.decoder.decode();
    } catch {
      throw new BrowserAnalysisError("invalid-response");
    }
    const messages = this.consumeLines();
    if (this.text.length !== 0 || this.dataLines.length !== 0 || this.eventName !== undefined) {
      throw new BrowserAnalysisError("invalid-response");
    }
    return messages;
  }

  private consumeLines(): SseMessage[] {
    const messages: SseMessage[] = [];
    let newline = this.text.indexOf("\n");
    while (newline >= 0) {
      let line = this.text.slice(0, newline);
      this.text = this.text.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.includes("\r")) throw new BrowserAnalysisError("invalid-response");
      const message = this.consumeLine(line);
      if (message !== undefined) messages.push(message);
      newline = this.text.indexOf("\n");
    }
    return messages;
  }

  private consumeLine(line: string): SseMessage | undefined {
    if (line === "") {
      if (this.dataLines.length === 0 && this.eventName === undefined) return undefined;
      if (this.dataLines.length === 0) throw new BrowserAnalysisError("invalid-response");
      const message = {
        data: this.dataLines.join("\n"),
        ...(this.eventName === undefined ? {} : { event: this.eventName }),
      };
      this.dataLines.length = 0;
      this.eventName = undefined;
      this.eventBytes = 0;
      return message;
    }
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    if (colon < 0) throw new BrowserAnalysisError("invalid-response");
    const field = line.slice(0, colon);
    const raw = line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "event") {
      if (value.length === 0 || this.eventName !== undefined) {
        throw new BrowserAnalysisError("invalid-response");
      }
      this.eventName = value;
    } else if (field === "data") {
      this.dataLines.push(value);
    } else {
      throw new BrowserAnalysisError("invalid-response");
    }
    return undefined;
  }
}
