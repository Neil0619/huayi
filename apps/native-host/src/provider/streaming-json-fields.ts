import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";

import { MAX_WIRE_MESSAGE_BYTES } from "@huayi/protocol";
import type { AnalysisDeltaSection, AnalysisSectionPayload } from "@huayi/protocol";

import type { AnalysisStreamUpdate } from "./analysis-provider.js";
import {
  modelAnalysisArrayItemSchemaFor,
  modelAnalysisFieldSchemaFor,
  type ModelResultType,
} from "./model-analysis-schemas.js";
import { ProviderValidationError } from "./provider-validation.js";
import {
  splitTextDelta,
  streamingTextFieldsFor,
  structuredSectionFor,
} from "./streaming-analysis-sections.js";
import { StreamingJsonTokenizer, type TopLevelJsonUpdate } from "./streaming-json-tokenizer.js";

export interface StreamingJsonFieldExtractorOptions {
  resultType: ModelResultType;
  sentenceContext: string | null;
}

export class StreamingJsonFieldExtractor {
  readonly #resultType: ModelResultType;
  readonly #sentenceContext: string | null;
  readonly #textFields: ReadonlyMap<string, AnalysisDeltaSection>;
  readonly #tokenizer = new StreamingJsonTokenizer();
  readonly #arrayItems = new Map<string, unknown[]>();
  #accumulatedBytes = 0;
  #failure: ProviderValidationError | undefined;
  #trailingInputHighSurrogate = false;

  constructor(options: StreamingJsonFieldExtractorOptions) {
    this.#resultType = options.resultType;
    this.#sentenceContext = options.sentenceContext;
    this.#textFields = streamingTextFieldsFor(options.resultType);
  }

  push(sourceChunk: string): AnalysisStreamUpdate[] {
    if (this.#failure !== undefined) throw this.#failure;
    this.#appendBoundedInput(sourceChunk);

    let tokenizerUpdates: TopLevelJsonUpdate[];
    try {
      tokenizerUpdates = this.#tokenizer.push(sourceChunk);
    } catch (cause) {
      return this.#fail(new ProviderValidationError("stream-parse", { cause }));
    }

    const streamUpdates: AnalysisStreamUpdate[] = [];
    for (const update of tokenizerUpdates) {
      if (update.kind === "string-delta") {
        const section = this.#textFields.get(update.field);
        if (section !== undefined) streamUpdates.push(...splitTextDelta(section, update.value));
        continue;
      }
      if (update.kind === "array-item") {
        const section = this.#validateAndMapArrayItem(update.field, update.index, update.value);
        if (section !== undefined) streamUpdates.push({ ...section, type: "analysis-section" });
        continue;
      }
      const section = this.#validateAndMapCompleteValue(update.field, update.value);
      if (section !== undefined) streamUpdates.push({ ...section, type: "analysis-section" });
    }
    return streamUpdates;
  }

  finish(): void {
    if (this.#failure !== undefined) throw this.#failure;
    try {
      this.#tokenizer.finish();
    } catch (cause) {
      return this.#fail(new ProviderValidationError("stream-parse", { cause }));
    }
  }

  #appendBoundedInput(sourceChunk: string): void {
    let addedBytes = Buffer.byteLength(sourceChunk, "utf8");
    const firstCode = sourceChunk.charCodeAt(0);
    if (
      this.#trailingInputHighSurrogate &&
      sourceChunk.length > 0 &&
      firstCode >= 0xdc00 &&
      firstCode <= 0xdfff
    ) {
      addedBytes -= 2;
    }
    if (this.#accumulatedBytes + addedBytes > MAX_WIRE_MESSAGE_BYTES) {
      return this.#fail(
        new ProviderValidationError("stream-parse", {
          cause: new RangeError("Assistant JSON exceeds the one-MiB UTF-8 limit."),
        }),
      );
    }
    this.#accumulatedBytes += addedBytes;
    if (sourceChunk.length > 0) {
      const lastCode = sourceChunk.charCodeAt(sourceChunk.length - 1);
      this.#trailingInputHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
    }
  }

  #validateAndMapCompleteValue(field: string, value: unknown): AnalysisSectionPayload | undefined {
    const schema = modelAnalysisFieldSchemaFor(this.#resultType, field);
    if (schema === undefined) return undefined;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return this.#fail(
        new ProviderValidationError("model-schema", { cause: parsed.error, field }),
      );
    }
    const arrayItems = this.#arrayItems.get(field);
    if (arrayItems !== undefined) {
      if (!Array.isArray(parsed.data) || !isDeepStrictEqual(parsed.data, arrayItems)) {
        return this.#fail(new ProviderValidationError("stream-parse", { field }));
      }
      this.#arrayItems.delete(field);
      return undefined;
    }
    try {
      return structuredSectionFor(this.#resultType, field, parsed.data, this.#sentenceContext);
    } catch (error) {
      if (error instanceof ProviderValidationError) return this.#fail(error);
      return this.#fail(new ProviderValidationError("result-assembly", { cause: error, field }));
    }
  }

  #validateAndMapArrayItem(
    field: string,
    index: number,
    value: unknown,
  ): AnalysisSectionPayload | undefined {
    const itemSchema = modelAnalysisArrayItemSchemaFor(this.#resultType, field);
    if (itemSchema === undefined) return undefined;
    const accumulated = this.#arrayItems.get(field) ?? [];
    if (index !== accumulated.length) {
      return this.#fail(new ProviderValidationError("stream-parse", { field }));
    }
    const parsedItem = itemSchema.safeParse(value);
    if (!parsedItem.success) {
      return this.#fail(
        new ProviderValidationError("model-schema", { cause: parsedItem.error, field }),
      );
    }
    const candidate = [...accumulated, parsedItem.data];
    const fieldSchema = modelAnalysisFieldSchemaFor(this.#resultType, field);
    const parsedCandidate = fieldSchema?.safeParse(candidate);
    if (parsedCandidate === undefined || !parsedCandidate.success) {
      return this.#fail(
        new ProviderValidationError("model-schema", {
          ...(parsedCandidate?.success === false ? { cause: parsedCandidate.error } : {}),
          field,
        }),
      );
    }
    const items = parsedCandidate.data as unknown[];
    this.#arrayItems.set(field, items);
    try {
      return structuredSectionFor(this.#resultType, field, items, this.#sentenceContext);
    } catch (error) {
      if (error instanceof ProviderValidationError) return this.#fail(error);
      return this.#fail(new ProviderValidationError("result-assembly", { cause: error, field }));
    }
  }

  #fail(failure: ProviderValidationError): never {
    this.#failure ??= failure;
    throw this.#failure;
  }
}
