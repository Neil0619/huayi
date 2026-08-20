import {
  analysisDeleteResponseSchema,
  analysisDeleteRequestSchema,
  analysisHistoryResponseSchema,
  analysisMutationRequestSchema,
  analysisRecordSchema,
  confirmCandidatesRequestSchema,
  confirmCandidatesResponseSchema,
  analysisRequestStatusSchema,
  listAnalysesQuerySchema,
  processAnalysisRequestSchema,
  revisionWriteHeadersSchema,
  startAnalysisRequestSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";

import type { AnalysisModule } from "./analysis-module.js";
import { CloudFault } from "./cloud-fault.js";

interface Dependencies {
  authenticate(context: Context): Promise<string> | string;
  module: AnalysisModule;
}

async function json(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new CloudFault("invalid_request", "Expected JSON.");
  }
}

function mutationHeaders(context: Context) {
  const parsed = revisionWriteHeadersSchema.safeParse({
    "idempotency-key": context.req.header("idempotency-key"),
    "if-match": context.req.header("if-match"),
  });
  if (!parsed.success) {
    throw new CloudFault("invalid_request", "Idempotency-Key and If-Match are required.");
  }
  return {
    expectedRevision: Number(parsed.data["if-match"].slice(1, -1)),
    idempotencyKey: parsed.data["idempotency-key"],
  };
}

function requireMatchingRevision(headerRevision: number, bodyRevision: number) {
  if (headerRevision !== bodyRevision) {
    throw new CloudFault("invalid_request", "If-Match must match expectedRevision.");
  }
}

export function createAnalysisApp(dependencies: Dependencies) {
  const app = new Hono();
  app.post("/v1/analyses:stream", async (context) => {
    const userId = await dependencies.authenticate(context);
    const key = context.req.header("idempotency-key");
    if (key === undefined) throw new CloudFault("invalid_request", "Idempotency-Key is required.");
    const input = startAnalysisRequestSchema.parse(await json(context));
    const events = await dependencies.module.preparePlatformAnalysis({
      idempotencyKey: key,
      input,
      userId,
    });
    return streamSSE(context, async (stream) => {
      let id = 0;
      for await (const event of events) {
        id += 1;
        await stream.writeSSE({ data: JSON.stringify(event), event: "analysis", id: String(id) });
      }
    });
  });

  app.get("/v1/analysis-requests/:requestId", async (context) => {
    const userId = await dependencies.authenticate(context);
    const status = await dependencies.module.getRequestStatus(
      userId,
      context.req.param("requestId"),
    );
    if (status === null) throw new CloudFault("not_found", "Analysis request not found.");
    return context.json(analysisRequestStatusSchema.parse(status));
  });

  app.get("/v1/analyses", async (context) => {
    const userId = await dependencies.authenticate(context);
    const query = listAnalysesQuerySchema.parse(context.req.query());
    return context.json(
      analysisHistoryResponseSchema.parse(await dependencies.module.listAnalyses(userId, query)),
    );
  });

  app.get("/v1/analyses/:id", async (context) => {
    const userId = await dependencies.authenticate(context);
    const item = await dependencies.module.getAnalysis(userId, context.req.param("id"));
    if (item === null) throw new CloudFault("not_found", "Analysis not found.");
    return context.json(item);
  });

  app.post("/v1/analyses/:id/process", async (context) => {
    const userId = await dependencies.authenticate(context);
    const headers = mutationHeaders(context);
    const input = processAnalysisRequestSchema.parse(await json(context));
    requireMatchingRevision(headers.expectedRevision, input.expectedRevision);
    return context.json(
      analysisRecordSchema.parse(
        await dependencies.module.processNothingToSave({
          ...headers,
          id: context.req.param("id"),
          userId,
        }),
      ),
    );
  });

  app.post("/v1/analyses/:id/candidates:confirm", async (context) => {
    const userId = await dependencies.authenticate(context);
    const headers = mutationHeaders(context);
    const input = confirmCandidatesRequestSchema.parse(await json(context));
    requireMatchingRevision(headers.expectedRevision, input.analysisRevision);
    return context.json(
      confirmCandidatesResponseSchema.parse(
        await dependencies.module.confirmCandidates({
          analysisId: context.req.param("id"),
          idempotencyKey: headers.idempotencyKey,
          input,
          userId,
        }),
      ),
    );
  });

  for (const [action, operation] of [
    ["archive", dependencies.module.archiveAnalysis],
    ["restore", dependencies.module.restoreAnalysis],
  ] as const) {
    app.post(`/v1/analyses/:id/${action}`, async (context) => {
      const userId = await dependencies.authenticate(context);
      const headers = mutationHeaders(context);
      const input = analysisMutationRequestSchema.parse(await json(context));
      requireMatchingRevision(headers.expectedRevision, input.expectedRevision);
      return context.json(
        analysisRecordSchema.parse(
          await operation({ ...headers, id: context.req.param("id"), userId }),
        ),
      );
    });
  }

  app.delete("/v1/analyses/:id", async (context) => {
    const userId = await dependencies.authenticate(context);
    const headers = mutationHeaders(context);
    const input = analysisDeleteRequestSchema.parse(await json(context));
    requireMatchingRevision(headers.expectedRevision, input.expectedRevision);
    return context.json(
      analysisDeleteResponseSchema.parse(
        await dependencies.module.deleteAnalysis({
          ...headers,
          deleteStudyCapture: input.deleteStudyCapture,
          id: context.req.param("id"),
          userId,
        }),
      ),
    );
  });
  return app;
}
