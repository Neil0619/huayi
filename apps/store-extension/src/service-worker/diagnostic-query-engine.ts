import {
  diagnosticCodeSchema,
  diagnosticEventSchema,
  type DiagnosticEvent,
} from "@huayi/cloud-contracts";
import type { AnalysisEngine } from "@huayi/store-domain";
import { BrowserAnalysisError } from "../analysis/analysis-error.js";
import type { DiagnosticOutbox } from "./diagnostic-outbox.js";

export function createDiagnosticQueryEngine(
  engine: AnalysisEngine,
  outbox: DiagnosticOutbox,
  clientVersion: string,
  provider: DiagnosticEvent["provider"],
): AnalysisEngine {
  return {
    async analyze(request, signal, onUpdate) {
      const ticket = await outbox.begin().catch(() => null);
      const started = performance.now();
      try {
        return await engine.analyze(request, signal, onUpdate);
      } catch (error) {
        if (
          !signal.aborted &&
          !(error instanceof BrowserAnalysisError && error.code === "cancelled")
        ) {
          const rawCode = error instanceof BrowserAnalysisError ? error.code : "internal_error";
          const codes: Record<string, DiagnosticEvent["code"]> = {
            "cloud-access-denied": "forbidden",
            "cloud-session-required": "authentication_required",
            "credential-missing": "configuration-required",
            "quota-exhausted": "quota_exhausted",
            "version-mismatch": "client_upgrade_required",
            "internal-error": "internal_error",
          };
          const code = diagnosticCodeSchema.safeParse(codes[rawCode] ?? rawCode);
          const parsed = diagnosticEventSchema.safeParse({
            version: 1,
            id: crypto.randomUUID(),
            occurredAt: new Date().toISOString(),
            source: "store",
            severity: [
              "credential-missing",
              "cloud-session-required",
              "cloud-access-denied",
              "quota-exhausted",
              "version-mismatch",
            ].includes(rawCode)
              ? "warn"
              : "error",
            operation: "instant-query",
            code: code.success ? code.data : "internal_error",
            stage:
              error instanceof BrowserAnalysisError && error.httpStatus !== undefined
                ? "http"
                : rawCode === "invalid-response"
                  ? "output-schema"
                  : rawCode === "internal-error" || rawCode === "internal_error"
                    ? "internal"
                    : rawCode === "timeout"
                      ? "model"
                      : "transport",
            clientVersion,
            requestId: request.requestId,
            provider,
            durationMs: Math.min(86_400_000, Math.round(performance.now() - started)),
            ...(error instanceof BrowserAnalysisError && error.httpStatus !== undefined
              ? { httpStatus: error.httpStatus }
              : {}),
            ...(error instanceof BrowserAnalysisError &&
            error.diagnosticId &&
            /^[0-9a-f-]{36}$/u.test(error.diagnosticId)
              ? { diagnosticId: error.diagnosticId }
              : {}),
          });
          if (parsed.success) await outbox.record(parsed.data, ticket).catch(() => undefined);
        }
        throw error;
      }
    },
  };
}
