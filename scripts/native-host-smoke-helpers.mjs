import { endianness, homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const MAX_WIRE_MESSAGE_BYTES = 1_048_576;

export const HEALTH_TIMEOUT_MS = 50_000;

function readLength(buffer) {
  return endianness() === "LE" ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
}

function writeLength(buffer, length) {
  if (endianness() === "LE") {
    buffer.writeUInt32LE(length, 0);
  } else {
    buffer.writeUInt32BE(length, 0);
  }
}

export function encodeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length === 0 || payload.length > MAX_WIRE_MESSAGE_BYTES) {
    throw new Error("Native message payload length is invalid.");
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  writeLength(frame, payload.length);
  payload.copy(frame, 4);
  return frame;
}

export class NativeMessageDecoder {
  #buffer = Buffer.alloc(0);
  #finished = false;

  push(chunk) {
    if (this.#finished) {
      throw new Error("Native message decoder already reached EOF.");
    }
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)]);
    const messages = [];
    while (this.#buffer.length >= 4) {
      const payloadLength = readLength(this.#buffer);
      if (payloadLength === 0 || payloadLength > MAX_WIRE_MESSAGE_BYTES) {
        this.#buffer = Buffer.alloc(0);
        throw new Error("Native host returned an invalid frame length.");
      }
      const frameLength = 4 + payloadLength;
      if (this.#buffer.length < frameLength) {
        break;
      }
      const payload = this.#buffer.subarray(4, frameLength).toString("utf8");
      this.#buffer = this.#buffer.subarray(frameLength);
      messages.push(JSON.parse(payload));
    }
    return messages;
  }

  finish() {
    this.#finished = true;
    if (this.#buffer.length > 0) {
      this.#buffer = Buffer.alloc(0);
      throw new Error("Incomplete native message frame at EOF.");
    }
  }
}

export function resolveCodexHome(explicitPath, homeDirectory = homedir()) {
  if (explicitPath !== undefined) {
    if (!isAbsolute(explicitPath)) {
      throw new Error("CODEX_HOME must be absolute.");
    }
    return explicitPath;
  }
  return join(homeDirectory, ".codex");
}

export function createNativeHostSpawnOptions({
  codexExecutable,
  codexHome,
  environment,
  platform,
  schemaDirectory,
  workingDirectory,
}) {
  if (!isAbsolute(codexHome)) {
    throw new Error("CODEX_HOME must be absolute.");
  }
  return {
    cwd: workingDirectory,
    detached: platform === "darwin",
    env: {
      ...environment,
      CODEX_HOME: codexHome,
      HUAYI_CODEX_PATH: codexExecutable,
      HUAYI_SCHEMA_DIR: schemaDirectory,
      HUAYI_WORK_DIR: workingDirectory,
    },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  };
}

function expectedResultType(request) {
  if (request.action === "translate") {
    return request.selectionKind === "word"
      ? "translate-word"
      : request.selectionKind === "phrase"
        ? "translate-lexical"
        : "translate-passage";
  }
  return request.selectionKind === "word"
    ? "explain-word"
    : request.selectionKind === "sentence"
      ? "explain-sentence"
      : "explain-lexical";
}

function validateListCardinality(result, key, minimum, maximum = 3) {
  const value = result[key];
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${key} must contain ${minimum} to ${maximum} items.`);
  }
}

export function validateSmokeResult(request, result) {
  if (result.sourceText !== request.selection || result.selectionKind !== request.selectionKind) {
    throw new Error(`Smoke result did not match request ${request.requestId}.`);
  }
  if (result.type !== expectedResultType(request)) {
    throw new Error(`Smoke result type did not match request ${request.requestId}.`);
  }
  if (result.type === "translate-lexical") {
    validateListCardinality(result, "collocations", 0);
    validateListCardinality(result, "similarTerms", 0);
    if (
      result.contextExample !== undefined &&
      (request.sentenceContext === null ||
        result.contextExample.english !== request.sentenceContext)
    ) {
      throw new Error("Smoke context example did not preserve the exact sentence context.");
    }
  }
  if (result.type === "translate-word") {
    validateListCardinality(result, "commonMeanings", 1, 4);
    validateListCardinality(result, "commonPhrases", 0, 4);
    validateListCardinality(result, "confusableWords", 0, 4);
    for (const group of result.commonMeanings) {
      if (
        !Array.isArray(group.meaningsZh) ||
        group.meaningsZh.length < 1 ||
        group.meaningsZh.length > 3
      ) {
        throw new Error("Each common meaning group must contain 1 to 3 meanings.");
      }
    }
  }
  if (result.type === "explain-lexical") {
    validateListCardinality(result, "collocations", 0);
    validateListCardinality(result, "coreMeanings", 1);
    validateListCardinality(result, "synonyms", 0);
  }
  if (result.type === "explain-word") {
    validateListCardinality(result, "usageNotes", 0);
    validateListCardinality(result, "synonyms", 0);
  }
  if (
    request.selectionKind === "paragraph" &&
    result.type === "translate-passage" &&
    !result.translationZh.includes("\n")
  ) {
    throw new Error("Paragraph translation did not preserve its line break.");
  }
  return result;
}
