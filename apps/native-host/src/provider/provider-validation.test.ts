import { describe, expect, it } from "vitest";

import {
  MAX_PROVIDER_DIAGNOSTIC_LINE_LENGTH,
  PROVIDER_VALIDATION_STAGES,
  ProviderValidationError,
  formatProviderValidationDiagnostic,
  providerValidationDiagnostic,
} from "./provider-validation.js";

describe("provider validation failures", () => {
  it("defines exactly the five trusted validation stages", () => {
    expect(PROVIDER_VALIDATION_STAGES).toEqual([
      "stream-parse",
      "model-json",
      "model-schema",
      "result-assembly",
      "protocol-validation",
    ]);
  });

  it("keeps only allowlisted fixed field names in diagnostics", () => {
    const allowed = new ProviderValidationError("model-schema", {
      cause: new Error("raw model secret"),
      field: "partOfSpeech",
    });
    const rejected = new ProviderValidationError("model-schema", {
      cause: new Error("raw model secret"),
      field: "Bearer fake-secret-token",
    });

    expect(providerValidationDiagnostic(allowed)).toEqual({
      field: "partOfSpeech",
      stage: "model-schema",
    });
    expect(providerValidationDiagnostic(rejected)).toEqual({ stage: "model-schema" });
  });

  it("formats a bounded allowlisted line without error causes or extra values", () => {
    const fakeSecret = "fake-secret-token";
    const diagnostic = {
      context: `Context ${fakeSecret}`,
      field: "contextExampleTranslationZh",
      modelJson: JSON.stringify({ value: fakeSecret }),
      stage: "result-assembly",
      token: fakeSecret,
    };

    const line = formatProviderValidationDiagnostic(diagnostic);

    expect(line).toBe(
      "Native host provider validation: stage=result-assembly " +
        "field=contextExampleTranslationZh\n",
    );
    expect(line?.length).toBeLessThanOrEqual(MAX_PROVIDER_DIAGNOSTIC_LINE_LENGTH);
    expect(line).not.toContain(fakeSecret);
  });

  it("refuses to format a non-allowlisted stage", () => {
    expect(
      formatProviderValidationDiagnostic({
        field: "partOfSpeech",
        stage: "fake-secret-token",
      }),
    ).toBeUndefined();
  });
});
