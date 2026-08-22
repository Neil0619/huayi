import type { StudyCaptureReader } from "../analysis-ports.js";

export function createFakeStudyCaptureReader(): StudyCaptureReader {
  return {
    async get() {
      return {
        activeAnalysisRequest: null,
        capture: {
          captureCount: 1,
          createdAt: "2026-08-12T09:00:00.000Z",
          firstCapturedAt: "2026-08-12T09:00:00.000Z",
          id: "capture-1",
          kind: "sentence",
          lastCapturedAt: "2026-08-12T09:00:00.000Z",
          normalizedTextHash: "a".repeat(64),
          revision: 1,
          sourceText: "This line is worth learning.",
          status: "pending",
          title: "A useful line",
          updatedAt: "2026-08-12T09:00:00.000Z",
          userContext: "Notice the tone.",
        },
        latestAnalysis: null,
      };
    },
  };
}
