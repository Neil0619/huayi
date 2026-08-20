import type { Request, Route } from "@playwright/test";
import {
  analysisEventSchema,
  analysisRecordSchema,
  contractFixtures,
  startAnalysisRequestSchema,
  type AnalysisRecord,
  type ApiError,
} from "@huayi/cloud-contracts";

import { cloudCors, cloudRequestBody } from "./cloud-browser-authority-request.js";
import type { CloudBrowserRequestFact } from "./cloud-browser-authority-types.js";

const streamPath = "/v1/analyses:stream";
const now = "2026-08-13T10:00:00.000Z";

interface StreamingAuthorityContext {
  onCompleted(analysis: AnalysisRecord): void;
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ): Promise<void>;
  writeProof(request: Request): string | null;
}

interface StoredStream {
  readonly body: string;
  readonly hash: string;
}

function analysisFor(input: ReturnType<typeof startAnalysisRequestSchema.parse>, ordinal: number) {
  const fixture = analysisRecordSchema.parse(contractFixtures.analysis);
  if (!("overall" in fixture.result)) throw new Error("Passage fixture missing.");
  return analysisRecordSchema.parse({
    ...fixture,
    createdAt: now,
    id: `analysis-stream-${ordinal}`,
    result: {
      ...fixture.result,
      sentences: fixture.result.sentences.map((sentence) => ({
        ...sentence,
        sourceText: input.sourceText,
      })),
    },
    selectionKind: input.selectionKind,
    source: input.source,
    sourceText: input.sourceText,
    updatedAt: now,
  });
}

function encodeSse(events: readonly unknown[]) {
  return events
    .map((event, index) => `event: analysis\nid: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

export function createCloudBrowserStreamingAuthority() {
  let completedCount = 0;
  const replays = new Map<string, StoredStream>();

  const fulfill = async (route: Route, body: string) => {
    await route.fulfill({
      body,
      contentType: "text/event-stream; charset=utf-8",
      headers: { ...cloudCors(route.request().headers().origin), "cache-control": "no-store" },
      status: 200,
    });
  };

  return {
    async handle(route: Route, context: StreamingAuthorityContext) {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname !== streamPath || request.method() !== "POST") return false;
      let inputBody: unknown;
      try {
        inputBody = cloudRequestBody(request);
      } catch {
        await context.reject(route, 400, "invalid_request");
        return true;
      }
      const parsed = startAnalysisRequestSchema.safeParse(inputBody);
      if (
        !parsed.success ||
        parsed.data.source.type !== "manual" ||
        parsed.data.selectionKind !== "passage"
      ) {
        await context.reject(route, 400, "invalid_request");
        return true;
      }
      const key = context.writeProof(request);
      if (key === null) {
        await context.reject(route, 403, "forbidden");
        return true;
      }
      const hash = JSON.stringify(parsed.data);
      const prior = replays.get(key);
      if (prior !== undefined) {
        if (prior.hash !== hash) {
          await context.reject(route, 409, "idempotency_conflict", "write-valid");
        } else {
          context.record(request, "write-valid");
          await fulfill(route, prior.body);
        }
        return true;
      }
      const analysis = analysisFor(parsed.data, completedCount + 1);
      const events = [
        analysisEventSchema.parse({
          requestId: `request-stream-${completedCount + 1}`,
          type: "analysis.started",
          unitCount: 1,
        }),
        analysisEventSchema.parse({
          requestId: `request-stream-${completedCount + 1}`,
          section: "overall",
          text: "正在识别可复用表达。",
          type: "analysis.preview",
        }),
        analysisEventSchema.parse({
          analysis,
          quota: contractFixtures.completedEvent.quota,
          type: "analysis.completed",
        }),
      ];
      const body = encodeSse(events);
      replays.set(key, { body, hash });
      completedCount += 1;
      context.onCompleted(analysis);
      context.record(request, "write-valid");
      await fulfill(route, body);
      return true;
    },
  };
}
