export const PROVIDER_VALIDATION_STAGES = [
  "stream-parse",
  "model-json",
  "model-schema",
  "result-assembly",
  "protocol-validation",
] as const;

export type ProviderValidationStage = (typeof PROVIDER_VALIDATION_STAGES)[number];

const PROVIDER_DIAGNOSTIC_FIELDS = [
  "baseForm",
  "collocations",
  "commonMeanings",
  "commonPhrases",
  "confusableWords",
  "contextExampleTranslationZh",
  "contextRole",
  "contextualMeaningZh",
  "contextualSense",
  "contextualAnalysisZh",
  "coreMeanings",
  "keyExpressions",
  "mainStructure",
  "partOfSpeech",
  "pronunciation",
  "similarTerms",
  "synonyms",
  "dictionaryForm",
  "usageNotes",
  "wordForm",
  "wordFormationZh",
  "translationZh",
  "wordFormation",
] as const;

export type ProviderDiagnosticField = (typeof PROVIDER_DIAGNOSTIC_FIELDS)[number];

export interface ProviderValidationDiagnostic {
  field?: ProviderDiagnosticField;
  stage: ProviderValidationStage;
}

export type ProviderValidationDiagnosticSink = (diagnostic: ProviderValidationDiagnostic) => void;

interface ProviderValidationErrorOptions {
  cause?: unknown;
  field?: unknown;
}

const stageNames = new Set<string>(PROVIDER_VALIDATION_STAGES);
const fieldNames = new Set<string>(PROVIDER_DIAGNOSTIC_FIELDS);

export const MAX_PROVIDER_DIAGNOSTIC_LINE_LENGTH = 160;

function providerValidationStage(value: unknown): ProviderValidationStage | undefined {
  if (typeof value !== "string" || !stageNames.has(value)) return undefined;
  return value as ProviderValidationStage;
}

export function providerDiagnosticField(value: unknown): ProviderDiagnosticField | undefined {
  if (typeof value !== "string" || !fieldNames.has(value)) return undefined;
  return value as ProviderDiagnosticField;
}

export class ProviderValidationError extends Error {
  readonly field: ProviderDiagnosticField | undefined;
  readonly stage: ProviderValidationStage;

  constructor(stage: ProviderValidationStage, options: ProviderValidationErrorOptions = {}) {
    super(
      "Provider result validation failed.",
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ProviderValidationError";
    this.field = providerDiagnosticField(options.field);
    this.stage = stage;
  }
}

export function providerValidationDiagnostic(
  failure: ProviderValidationError,
): ProviderValidationDiagnostic {
  return failure.field === undefined
    ? { stage: failure.stage }
    : { field: failure.field, stage: failure.stage };
}

export function formatProviderValidationDiagnostic(diagnostic: unknown): string | undefined {
  if (typeof diagnostic !== "object" || diagnostic === null || Array.isArray(diagnostic)) {
    return undefined;
  }
  const record = diagnostic as Record<string, unknown>;
  const stage = providerValidationStage(record.stage);
  if (stage === undefined) return undefined;

  const field = providerDiagnosticField(record.field);
  const unboundedLine = `Native host provider validation: stage=${stage}${
    field === undefined ? "" : ` field=${field}`
  }`;
  return `${unboundedLine.slice(0, MAX_PROVIDER_DIAGNOSTIC_LINE_LENGTH - 1)}\n`;
}
