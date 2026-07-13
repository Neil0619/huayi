export type TopLevelJsonUpdate =
  | { field: string; kind: "string-delta"; value: string }
  | { field: string; kind: "complete-value"; value: unknown };

type Container = "array" | "object";
type EscapeState = "none" | "simple" | "unicode";
type RootState =
  "after-value" | "before-root" | "colon" | "complete" | "key" | "key-or-end" | "value";
type StringRole = "nested" | "root-key" | "root-value";
type ValueMode = "container" | "primitive";

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

export class StreamingJsonTokenizer {
  readonly #containers: Container[] = [];
  readonly #seenFields = new Set<string>();
  #decodedHighSurrogate: string | undefined;
  #decodedString = "";
  #escapeState: EscapeState = "none";
  #failure: Error | undefined;
  #field = "";
  #finished = false;
  #rootState: RootState = "before-root";
  #stringRole: StringRole | undefined;
  #unicodeEscape = "";
  #valueMode: ValueMode | undefined;
  #valueSource = "";

  push(sourceChunk: string): TopLevelJsonUpdate[] {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#finished) return this.#fail(new SyntaxError("JSON input is already complete."));

    const updates: TopLevelJsonUpdate[] = [];
    for (let index = 0; index < sourceChunk.length; index += 1) {
      this.#processCharacter(sourceChunk.charAt(index), updates);
    }
    return updates;
  }

  finish(): void {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#finished) return;
    if (
      this.#rootState !== "complete" ||
      this.#stringRole !== undefined ||
      this.#valueMode !== undefined ||
      this.#escapeState !== "none" ||
      this.#decodedHighSurrogate !== undefined ||
      this.#containers.length !== 0
    ) {
      return this.#fail(new SyntaxError("Incomplete JSON input."));
    }
    this.#finished = true;
  }

  #processCharacter(character: string, updates: TopLevelJsonUpdate[]): void {
    if (this.#stringRole !== undefined) {
      this.#processStringCharacter(character, updates);
      return;
    }
    if (this.#valueMode === "container") {
      this.#processContainerCharacter(character, updates);
      return;
    }
    if (this.#valueMode === "primitive") {
      this.#processPrimitiveCharacter(character, updates);
      return;
    }
    if (isJsonWhitespace(character)) return;

    switch (this.#rootState) {
      case "before-root":
        if (character !== "{") return this.#fail(new SyntaxError("Expected a root JSON object."));
        this.#rootState = "key-or-end";
        return;
      case "key-or-end":
        if (character === "}") {
          this.#rootState = "complete";
          return;
        }
        if (character !== '"') return this.#fail(new SyntaxError("Expected an object key."));
        this.#beginString("root-key");
        return;
      case "key":
        if (character !== '"') return this.#fail(new SyntaxError("Expected an object key."));
        this.#beginString("root-key");
        return;
      case "colon":
        if (character !== ":") return this.#fail(new SyntaxError("Expected a colon."));
        this.#rootState = "value";
        return;
      case "value":
        this.#beginValue(character);
        return;
      case "after-value":
        if (character === ",") {
          this.#rootState = "key";
          return;
        }
        if (character === "}") {
          this.#rootState = "complete";
          return;
        }
        return this.#fail(new SyntaxError("Expected a comma or object end."));
      case "complete":
        return this.#fail(new SyntaxError("Unexpected trailing JSON input."));
    }
  }

  #beginValue(character: string): void {
    this.#valueSource = character;
    if (character === '"') {
      this.#beginString("root-value");
      return;
    }
    if (character === "{" || character === "[") {
      this.#valueMode = "container";
      this.#containers.push(character === "{" ? "object" : "array");
      return;
    }
    if (isPrimitiveStart(character)) {
      this.#valueMode = "primitive";
      return;
    }
    return this.#fail(new SyntaxError("Expected a JSON value."));
  }

  #processContainerCharacter(character: string, updates: TopLevelJsonUpdate[]): void {
    this.#valueSource += character;
    if (character === '"') {
      this.#beginString("nested");
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
    if (this.#containers.length === 0) this.#completeValue(updates);
  }

  #processPrimitiveCharacter(character: string, updates: TopLevelJsonUpdate[]): void {
    if (isJsonWhitespace(character) || character === "," || character === "}") {
      this.#completeValue(updates);
      this.#processCharacter(character, updates);
      return;
    }
    this.#valueSource += character;
  }

  #beginString(role: StringRole): void {
    this.#stringRole = role;
    this.#escapeState = "none";
    this.#unicodeEscape = "";
    this.#decodedHighSurrogate = undefined;
    if (role === "root-key") this.#decodedString = "";
  }

  #processStringCharacter(character: string, updates: TopLevelJsonUpdate[]): void {
    if (this.#stringRole !== "root-key") this.#valueSource += character;
    if (this.#escapeState === "simple") {
      if (character === "u") {
        this.#escapeState = "unicode";
        this.#unicodeEscape = "";
        return;
      }
      const decoded = simpleEscape(character);
      if (decoded === undefined) return this.#fail(new SyntaxError("Invalid JSON escape."));
      this.#escapeState = "none";
      this.#acceptDecodedCharacter(decoded, updates);
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
        this.#acceptDecodedCharacter(decoded, updates);
      }
      return;
    }
    if (character === "\\") {
      this.#escapeState = "simple";
      return;
    }
    if (character === '"') {
      this.#finishString(updates);
      return;
    }
    if (character.charCodeAt(0) < 0x20) {
      return this.#fail(new SyntaxError("Unescaped control character in JSON string."));
    }
    this.#acceptDecodedCharacter(character, updates);
  }

  #acceptDecodedCharacter(character: string, updates: TopLevelJsonUpdate[]): void {
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
      this.#decodedString += decoded;
    } else if (this.#stringRole === "root-value") {
      this.#appendStringDelta(updates, decoded);
    }
  }

  #appendStringDelta(updates: TopLevelJsonUpdate[], value: string): void {
    const previous = updates[updates.length - 1];
    if (previous?.kind === "string-delta" && previous.field === this.#field) {
      previous.value += value;
      return;
    }
    updates.push({ field: this.#field, kind: "string-delta", value });
  }

  #finishString(updates: TopLevelJsonUpdate[]): void {
    if (this.#decodedHighSurrogate !== undefined) {
      return this.#fail(new SyntaxError("Unpaired high surrogate in JSON string."));
    }
    const role = this.#stringRole;
    this.#stringRole = undefined;
    if (role === "root-key") {
      if (this.#seenFields.has(this.#decodedString)) {
        return this.#fail(new SyntaxError("Duplicate root JSON field."));
      }
      this.#seenFields.add(this.#decodedString);
      this.#field = this.#decodedString;
      this.#rootState = "colon";
    } else if (role === "root-value") {
      this.#completeValue(updates);
    }
  }

  #completeValue(updates: TopLevelJsonUpdate[]): void {
    let value: unknown;
    try {
      value = JSON.parse(this.#valueSource);
    } catch (cause) {
      return this.#fail(new SyntaxError("Invalid JSON value.", { cause }));
    }
    updates.push({ field: this.#field, kind: "complete-value", value });
    this.#containers.length = 0;
    this.#valueMode = undefined;
    this.#valueSource = "";
    this.#rootState = "after-value";
  }

  #fail(error: Error): never {
    this.#failure = error;
    throw error;
  }
}
