import { MAX_ANALYSIS_JSON_BYTES } from "@huayi/store-domain";

import { BrowserAnalysisError } from "./analysis-error.js";
import { parseModelArrayItem, parseModelField, type ModelResultType } from "./model-contracts.js";
import {
  splitTextDelta,
  streamingTextFieldsFor,
  structuredSectionFor,
  type PreviewUpdate,
} from "./streaming-analysis-sections.js";
import { StreamingJsonTokenizer, type TopLevelJsonUpdate } from "./streaming-json-tokenizer.js";

export class IncrementalJsonPreview {
  private readonly arrayItems = new Map<string, unknown[]>();
  private readonly textFields: ReturnType<typeof streamingTextFieldsFor>;
  private readonly tokenizer = new StreamingJsonTokenizer();
  private source = "";

  constructor(
    private readonly type: ModelResultType,
    private readonly sentenceContext: string | null,
  ) {
    this.textFields = streamingTextFieldsFor(type);
  }

  push(chunk: string): PreviewUpdate[] {
    this.source += chunk;
    if (new TextEncoder().encode(this.source).byteLength > MAX_ANALYSIS_JSON_BYTES) {
      throw new BrowserAnalysisError("invalid-response");
    }
    try {
      return this.tokenizer.push(chunk).flatMap((update) => this.previewUpdate(update));
    } catch (error) {
      if (error instanceof BrowserAnalysisError) throw error;
      throw new BrowserAnalysisError("invalid-response");
    }
  }

  finish(): string {
    try {
      this.tokenizer.finish();
      JSON.parse(this.source);
      return this.source;
    } catch (error) {
      if (error instanceof BrowserAnalysisError) throw error;
      throw new BrowserAnalysisError("invalid-response");
    }
  }

  private previewUpdate(update: TopLevelJsonUpdate): PreviewUpdate[] {
    if (update.kind === "string-delta") {
      const section = this.textFields.get(update.field);
      return section === undefined ? [] : splitTextDelta(section, update.value);
    }
    if (update.kind === "array-item") return this.arrayItem(update);

    const parsed = parseModelField(this.type, update.field, update.value);
    if (parsed === undefined) return [];
    const items = this.arrayItems.get(update.field);
    if (items !== undefined) {
      if (!Array.isArray(parsed) || JSON.stringify(parsed) !== JSON.stringify(items)) {
        throw new BrowserAnalysisError("invalid-response");
      }
      this.arrayItems.delete(update.field);
      return [];
    }
    const section = structuredSectionFor(this.type, update.field, parsed, this.sentenceContext);
    return section === undefined ? [] : [section];
  }

  private arrayItem(update: Extract<TopLevelJsonUpdate, { kind: "array-item" }>): PreviewUpdate[] {
    const item = parseModelArrayItem(this.type, update.field, update.value);
    if (item === undefined) return [];
    const previous = this.arrayItems.get(update.field) ?? [];
    if (update.index !== previous.length) throw new BrowserAnalysisError("invalid-response");
    const candidate = parseModelField(this.type, update.field, [...previous, item]);
    if (!Array.isArray(candidate)) throw new BrowserAnalysisError("invalid-response");
    this.arrayItems.set(update.field, candidate);
    const section = structuredSectionFor(this.type, update.field, candidate, this.sentenceContext);
    return section === undefined ? [] : [section];
  }
}
