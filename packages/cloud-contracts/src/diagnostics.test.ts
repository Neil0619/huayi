import { describe, expect, it } from "vitest";
import { diagnosticEventSchema, diagnosticUploadSchema } from "./diagnostics.js";
import { safeDiagnosticIssues } from "./diagnostic-issues.js";

const event = {
  version: 1,
  id: "71000000-0000-4000-8000-000000000001",
  occurredAt: "2026-09-07T00:00:00.000Z",
  source: "store",
  severity: "error",
  operation: "instant-query",
  code: "provider-error",
  stage: "http",
  httpStatus: 429,
};
describe("diagnostic privacy boundary", () => {
  it("redacts dynamic schema keys and drops issue messages", () => {
    const issues = safeDiagnosticIssues([
      { path: ["candidates", 0, "secret-value"], code: "custom", rule: "private-token" },
    ]);
    expect(issues).toEqual([{ path: ["candidates", "*", "[redacted]"], code: "custom" }]);
  });
  it("accepts only bounded, known metadata", () => {
    expect(diagnosticEventSchema.parse(event)).toEqual(event);
    for (const extra of [
      { message: "private text" },
      { apiKey: "secret" },
      { url: "https://private" },
      { userId: "spoof" },
      { code: "secret" },
      { requestId: "token" },
      { provider: "custom secret" },
    ]) {
      expect(diagnosticEventSchema.safeParse({ ...event, ...extra }).success).toBe(false);
    }
  });
  it("requires the versioned consent and bounds uploads", () => {
    expect(diagnosticUploadSchema.safeParse({ consentVersion: 1, events: [event] }).success).toBe(
      true,
    );
    expect(diagnosticUploadSchema.safeParse({ events: [event] }).success).toBe(false);
    expect(
      diagnosticUploadSchema.safeParse({
        consentVersion: 1,
        events: Array.from({ length: 21 }, () => event),
      }).success,
    ).toBe(false);
  });
});
