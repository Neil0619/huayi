import { BrowserAnalysisError } from "./analysis-error.js";

function isWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isNonzeroDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "1" && character <= "9";
}

function isHexDigit(character: string | undefined): boolean {
  return character !== undefined && /^[0-9A-Fa-f]$/u.test(character);
}

class ProviderJsonValidator {
  private offset = 0;

  constructor(private readonly source: string) {}

  validate(): void {
    this.skipWhitespace();
    this.readValue();
    this.skipWhitespace();
    if (this.offset !== this.source.length) this.fail();
  }

  private readValue(): void {
    switch (this.source[this.offset]) {
      case '"':
        this.readString();
        return;
      case "{":
        this.readObject();
        return;
      case "[":
        this.readArray();
        return;
      case "t":
        this.readLiteral("true");
        return;
      case "f":
        this.readLiteral("false");
        return;
      case "n":
        this.readLiteral("null");
        return;
      default:
        this.readNumber();
    }
  }

  private readObject(): void {
    this.offset += 1;
    this.skipWhitespace();
    if (this.consume("}")) return;
    const keys = new Set<string>();
    while (true) {
      if (this.source[this.offset] !== '"') this.fail();
      const key = this.readString();
      if (keys.has(key)) this.fail();
      keys.add(key);
      this.skipWhitespace();
      if (!this.consume(":")) this.fail();
      this.skipWhitespace();
      this.readValue();
      this.skipWhitespace();
      if (this.consume("}")) return;
      if (!this.consume(",")) this.fail();
      this.skipWhitespace();
    }
  }

  private readArray(): void {
    this.offset += 1;
    this.skipWhitespace();
    if (this.consume("]")) return;
    while (true) {
      this.readValue();
      this.skipWhitespace();
      if (this.consume("]")) return;
      if (!this.consume(",")) this.fail();
      this.skipWhitespace();
    }
  }

  private readString(): string {
    if (!this.consume('"')) this.fail();
    let decoded = "";
    while (this.offset < this.source.length) {
      const character = this.source[this.offset];
      this.offset += 1;
      if (character === '"') return decoded;
      if (character === undefined || character.charCodeAt(0) < 0x20) this.fail();
      if (character !== "\\") {
        decoded += character;
        continue;
      }
      const escape = this.source[this.offset];
      this.offset += 1;
      switch (escape) {
        case '"':
        case "\\":
        case "/":
          decoded += escape;
          break;
        case "b":
          decoded += "\b";
          break;
        case "f":
          decoded += "\f";
          break;
        case "n":
          decoded += "\n";
          break;
        case "r":
          decoded += "\r";
          break;
        case "t":
          decoded += "\t";
          break;
        case "u": {
          const digits = this.source.slice(this.offset, this.offset + 4);
          if (digits.length !== 4 || [...digits].some((digit) => !isHexDigit(digit))) this.fail();
          decoded += String.fromCharCode(Number.parseInt(digits, 16));
          this.offset += 4;
          break;
        }
        default:
          this.fail();
      }
    }
    return this.fail();
  }

  private readLiteral(literal: "false" | "null" | "true"): void {
    if (!this.source.startsWith(literal, this.offset)) this.fail();
    this.offset += literal.length;
  }

  private readNumber(): void {
    if (this.consume("-")) {
      if (!isDigit(this.source[this.offset])) this.fail();
    }
    if (this.consume("0")) {
      if (isDigit(this.source[this.offset])) this.fail();
    } else {
      if (!isNonzeroDigit(this.source[this.offset])) this.fail();
      this.offset += 1;
      while (isDigit(this.source[this.offset])) this.offset += 1;
    }
    if (this.consume(".")) {
      if (!isDigit(this.source[this.offset])) this.fail();
      while (isDigit(this.source[this.offset])) this.offset += 1;
    }
    const exponent = this.source[this.offset];
    if (exponent === "e" || exponent === "E") {
      this.offset += 1;
      const sign = this.source[this.offset];
      if (sign === "+" || sign === "-") this.offset += 1;
      if (!isDigit(this.source[this.offset])) this.fail();
      while (isDigit(this.source[this.offset])) this.offset += 1;
    }
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.source[this.offset])) this.offset += 1;
  }

  private consume(character: string): boolean {
    if (this.source[this.offset] !== character) return false;
    this.offset += 1;
    return true;
  }

  private fail(): never {
    throw new BrowserAnalysisError("invalid-response");
  }
}

export function parseProviderJson(source: string): unknown {
  new ProviderJsonValidator(source).validate();
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new BrowserAnalysisError("invalid-response");
  }
}
