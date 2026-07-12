import { Buffer } from "node:buffer";

import { MAX_STREAM_DELTA_LENGTH, MAX_WIRE_MESSAGE_BYTES } from "@huayi/protocol";
import type { AnalysisDeltaSection } from "@huayi/protocol";

import type { AnalysisStreamChunk } from "./analysis-provider.js";

type Container = "array" | "object";
type RootState =
  | "after-value"
  | "before-root"
  | "colon"
  | "complete"
  | "in-nested-value"
  | "in-primitive"
  | "key-or-end"
  | "value";
type StringRole = "ignored-nested" | "ignored-root-value" | "root-key" | "stream-value";
type EscapeState = "none" | "simple" | "unicode";

function isJsonWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isPrimitiveStart(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    character === "-" ||
    character === "f" ||
    character === "n" ||
    character === "t" ||
    (code >= 0x30 && code <= 0x39)
  );
}

function isHexDigit(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

function isHighSurrogate(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 0xdc00 && code <= 0xdfff;
}

function simpleEscape(character: string): string | undefined {
  switch (character) {
    case '"':
    case "\\":
    case "/":
      return character;
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      return undefined;
  }
}

export class StreamingJsonFieldExtractor {
  readonly #configuredFields: ReadonlyMap<string, AnalysisDeltaSection>;
  readonly #containers: Container[] = [];
  readonly #seenConfiguredFields = new Set<string>();
  #accumulatedBytes = 0;
  #decodedHighSurrogate: string | undefined;
  #escapeState: EscapeState = "none";
  #failure: Error | undefined;
  #finished = false;
  #key = "";
  #pendingKey = "";
  #rootState: RootState = "before-root";
  #source = "";
  #streamSection: AnalysisDeltaSection | undefined;
  #stringRole: StringRole | undefined;
  #trailingInputHighSurrogate = false;
  #unicodeEscape = "";

  constructor(configuredFields: ReadonlyMap<string, AnalysisDeltaSection>) {
    this.#configuredFields = new Map(configuredFields);
  }

  push(sourceChunk: string): AnalysisStreamChunk[] {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#finished) return this.#fail(new SyntaxError("JSON input is already complete."));

    this.#appendBoundedInput(sourceChunk);
    const chunks: AnalysisStreamChunk[] = [];
    let delta = "";
    let section: AnalysisDeltaSection | undefined;

    const flush = (): void => {
      if (section !== undefined && delta.length > 0) chunks.push({ delta, section });
      delta = "";
      section = undefined;
    };
    const emit = (text: string, nextSection: AnalysisDeltaSection): void => {
      if (section !== undefined && section !== nextSection) flush();
      section = nextSection;
      if (delta.length + text.length > MAX_STREAM_DELTA_LENGTH) flush();
      section = nextSection;
      delta += text;
    };

    let index = 0;
    while (index < sourceChunk.length) {
      this.#processCharacter(sourceChunk.charAt(index), emit);
      index += 1;
    }
    flush();
    return chunks;
  }

  finish(): void {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#finished) return;
    if (
      this.#rootState !== "complete" ||
      this.#stringRole !== undefined ||
      this.#escapeState !== "none" ||
      this.#decodedHighSurrogate !== undefined ||
      this.#containers.length !== 0
    ) {
      return this.#fail(new SyntaxError("Incomplete JSON input."));
    }
    try {
      JSON.parse(this.#source);
    } catch (error) {
      return this.#fail(new SyntaxError("Invalid JSON input.", { cause: error }));
    }
    this.#finished = true;
  }

  #appendBoundedInput(sourceChunk: string): void {
    let addedBytes = Buffer.byteLength(sourceChunk, "utf8");
    if (
      this.#trailingInputHighSurrogate &&
      sourceChunk.length > 0 &&
      isLowSurrogate(sourceChunk[0] ?? "")
    ) {
      addedBytes -= 2;
    }
    const nextBytes = this.#accumulatedBytes + addedBytes;
    if (nextBytes > MAX_WIRE_MESSAGE_BYTES) {
      return this.#fail(new RangeError("JSON input exceeds the one-MiB UTF-8 limit."));
    }
    this.#accumulatedBytes = nextBytes;
    if (sourceChunk.length > 0) {
      this.#trailingInputHighSurrogate = isHighSurrogate(sourceChunk[sourceChunk.length - 1] ?? "");
    }
    this.#source += sourceChunk;
  }

  #processCharacter(
    character: string,
    emit: (text: string, section: AnalysisDeltaSection) => void,
  ): void {
    if (this.#stringRole !== undefined) {
      this.#processStringCharacter(character, emit);
      return;
    }
    if (this.#rootState === "in-nested-value") {
      this.#processNestedCharacter(character);
      return;
    }
    if (this.#rootState === "in-primitive") {
      if (isJsonWhitespace(character)) {
        this.#rootState = "after-value";
        return;
      }
      if (character === "," || character === "}") {
        this.#rootState = "after-value";
        this.#processCharacter(character, emit);
      }
      return;
    }
    if (isJsonWhitespace(character)) return;

    switch (this.#rootState) {
      case "before-root":
        if (character !== "{") return this.#fail(new SyntaxError("Expected a JSON object."));
        this.#containers.push("object");
        this.#rootState = "key-or-end";
        return;
      case "key-or-end":
        if (character === "}") {
          this.#containers.pop();
          this.#rootState = "complete";
          return;
        }
        if (character !== '"') return this.#fail(new SyntaxError("Expected an object key."));
        this.#beginString("root-key");
        return;
      case "colon":
        if (character !== ":") return this.#fail(new SyntaxError("Expected a colon."));
        this.#rootState = "value";
        return;
      case "value":
        this.#beginRootValue(character);
        return;
      case "after-value":
        if (character === ",") {
          this.#rootState = "key-or-end";
          return;
        }
        if (character === "}") {
          this.#containers.pop();
          this.#rootState = "complete";
          return;
        }
        return this.#fail(new SyntaxError("Expected a comma or object end."));
      case "complete":
        return this.#fail(new SyntaxError("Unexpected trailing JSON input."));
      default:
        return this.#fail(new SyntaxError("Invalid JSON parser state."));
    }
  }

  #beginRootValue(character: string): void {
    const streamSection = this.#configuredFields.get(this.#pendingKey);
    if (streamSection !== undefined) {
      if (character !== '"') {
        return this.#fail(new SyntaxError("Configured streaming fields must be strings."));
      }
      this.#streamSection = streamSection;
      this.#beginString("stream-value");
      return;
    }
    if (character === '"') {
      this.#beginString("ignored-root-value");
      return;
    }
    if (character === "{" || character === "[") {
      this.#containers.push(character === "{" ? "object" : "array");
      this.#rootState = "in-nested-value";
      return;
    }
    if (isPrimitiveStart(character)) {
      this.#rootState = "in-primitive";
      return;
    }
    return this.#fail(new SyntaxError("Expected a JSON value."));
  }

  #processNestedCharacter(character: string): void {
    if (character === '"') {
      this.#beginString("ignored-nested");
      return;
    }
    if (character === "{" || character === "[") {
      this.#containers.push(character === "{" ? "object" : "array");
      return;
    }
    if (character !== "}" && character !== "]") return;
    const expected = character === "}" ? "object" : "array";
    if (this.#containers[this.#containers.length - 1] !== expected) {
      return this.#fail(new SyntaxError("Mismatched JSON container."));
    }
    this.#containers.pop();
    if (this.#containers.length === 1) this.#rootState = "after-value";
  }

  #beginString(role: StringRole): void {
    this.#stringRole = role;
    this.#escapeState = "none";
    this.#unicodeEscape = "";
    this.#decodedHighSurrogate = undefined;
    if (role === "root-key") this.#key = "";
  }

  #processStringCharacter(
    character: string,
    emit: (text: string, section: AnalysisDeltaSection) => void,
  ): void {
    if (this.#escapeState === "simple") {
      if (character === "u") {
        this.#escapeState = "unicode";
        this.#unicodeEscape = "";
        return;
      }
      const decoded = simpleEscape(character);
      if (decoded === undefined) return this.#fail(new SyntaxError("Invalid JSON escape."));
      this.#escapeState = "none";
      this.#acceptDecodedCharacter(decoded, emit);
      return;
    }
    if (this.#escapeState === "unicode") {
      if (!isHexDigit(character)) {
        return this.#fail(new SyntaxError("Invalid JSON Unicode escape."));
      }
      this.#unicodeEscape += character;
      if (this.#unicodeEscape.length === 4) {
        const decoded = String.fromCharCode(Number.parseInt(this.#unicodeEscape, 16));
        this.#escapeState = "none";
        this.#unicodeEscape = "";
        this.#acceptDecodedCharacter(decoded, emit);
      }
      return;
    }
    if (character === "\\") {
      this.#escapeState = "simple";
      return;
    }
    if (character === '"') {
      this.#finishString();
      return;
    }
    if (character.charCodeAt(0) < 0x20) {
      return this.#fail(new SyntaxError("Unescaped control character in JSON string."));
    }
    this.#acceptDecodedCharacter(character, emit);
  }

  #acceptDecodedCharacter(
    character: string,
    emit: (text: string, section: AnalysisDeltaSection) => void,
  ): void {
    if (this.#stringRole === "ignored-nested" || this.#stringRole === "ignored-root-value") return;
    let decoded = character;
    if (this.#decodedHighSurrogate !== undefined) {
      if (!isLowSurrogate(character)) {
        return this.#fail(new SyntaxError("Unpaired high surrogate in JSON string."));
      }
      decoded = this.#decodedHighSurrogate + character;
      this.#decodedHighSurrogate = undefined;
    } else if (isHighSurrogate(character)) {
      this.#decodedHighSurrogate = character;
      return;
    } else if (isLowSurrogate(character)) {
      return this.#fail(new SyntaxError("Unpaired low surrogate in JSON string."));
    }

    if (this.#stringRole === "root-key") {
      this.#key += decoded;
    } else if (this.#stringRole === "stream-value" && this.#streamSection !== undefined) {
      emit(decoded, this.#streamSection);
    }
  }

  #finishString(): void {
    if (this.#decodedHighSurrogate !== undefined) {
      return this.#fail(new SyntaxError("Unpaired high surrogate in JSON string."));
    }
    const role = this.#stringRole;
    this.#stringRole = undefined;
    if (role === "root-key") {
      if (this.#configuredFields.has(this.#key)) {
        if (this.#seenConfiguredFields.has(this.#key)) {
          return this.#fail(new SyntaxError("Duplicate configured streaming field."));
        }
        this.#seenConfiguredFields.add(this.#key);
      }
      this.#pendingKey = this.#key;
      this.#rootState = "colon";
    } else if (role === "ignored-root-value" || role === "stream-value") {
      this.#streamSection = undefined;
      this.#rootState = "after-value";
    }
  }

  #fail(error: Error): never {
    this.#failure = error;
    throw error;
  }
}
