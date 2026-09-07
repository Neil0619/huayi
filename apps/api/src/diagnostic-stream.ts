import { streamSSE as honoStreamSSE } from "hono/streaming";
import {
  captureDiagnostic,
  diagnosticCode,
  diagnosticScopeOptions,
  runDiagnosticScope,
  setDiagnosticContext,
} from "./diagnostic-context.js";
import type { LearningTaskPayload } from "@huayi/cloud-contracts";

/** Hono returns headers before the producer finishes; flush inside the producer, not middleware. */
export function streamSSE(
  context: Parameters<typeof honoStreamSSE>[0],
  callback: Parameters<typeof honoStreamSSE>[1],
) {
  const scope = diagnosticScopeOptions();
  return honoStreamSSE(context, async (stream) => {
    const run = async () => {
      try {
        await callback(stream);
      } catch (error) {
        if (!stream.aborted)
          captureDiagnostic({
            code: diagnosticCode(
              typeof error === "object" && error !== null && "code" in error
                ? error.code
                : undefined,
            ),
            stage: "internal",
          });
      }
    };
    if (scope) await runDiagnosticScope(scope, run);
    else await run();
  });
}

export function captureDiagnosticPayload(event: LearningTaskPayload): void {
  if (event.type === "analysis.started")
    setDiagnosticContext({ generationId: event.requestId, operation: "analysis" });
  if ("generationId" in event)
    setDiagnosticContext({ generationId: event.generationId, operation: "instant-query" });
  if (event.type === "analysis.failed" || event.type === "query.failed") {
    captureDiagnostic({ code: diagnosticCode(event.error.code), stage: "task" });
  }
}
