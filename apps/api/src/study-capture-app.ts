import {
  studyCaptureCreateRequestSchema,
  studyCaptureCreateResponseSchema,
  studyCaptureAnalyzeRequestSchema,
  studyCaptureDeleteRequestSchema,
  studyCaptureDeleteResponseSchema,
  studyCaptureDetailResponseSchema,
  studyCaptureHttpRoutes,
  studyCaptureListQuerySchema,
  studyCaptureListResponseSchema,
  studyCapturePatchRequestSchema,
  studyCapturePatchResponseSchema,
  revisionWriteHeadersSchema,
  writeHeadersSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";

import { CloudFault } from "./cloud-fault.js";
import type { StudyCaptureModule } from "./study-capture-module.js";
import type { AnalysisModule } from "./analysis-module.js";

export function createStudyCaptureApp(options: {
  analysis?: Pick<AnalysisModule, "prepareStudyCaptureAnalysis">;
  authenticateCreate(context: Context): Promise<string> | string;
  authenticateDelete(context: Context): Promise<string> | string;
  authenticateWeb(context: Context): Promise<string> | string;
  module: StudyCaptureModule;
}) {
  const app = new Hono();
  app.post(studyCaptureHttpRoutes.analyze, async (context) => {
    const owner = await options.authenticateWeb(context);
    const headers = revisionWriteHeadersSchema.safeParse({
      "idempotency-key": context.req.header("idempotency-key"),
      "if-match": context.req.header("if-match"),
    });
    if (!headers.success) throw new CloudFault("invalid_request", "Write proof is required.");
    const input = studyCaptureAnalyzeRequestSchema.parse(await context.req.json());
    if (Number(headers.data["if-match"].slice(1, -1)) !== input.expectedRevision) {
      throw new CloudFault("invalid_request", "If-Match must match expectedRevision.");
    }
    if (options.analysis === undefined) {
      throw new CloudFault("model_unavailable", "StudyCapture analysis is not configured.");
    }
    const events = await options.analysis.prepareStudyCaptureAnalysis({
      captureId: context.req.param("id"),
      idempotencyKey: headers.data["idempotency-key"],
      input,
      userId: owner,
    });
    return streamSSE(context, async (stream) => {
      let id = 0;
      for await (const event of events) {
        id += 1;
        await stream.writeSSE({ data: JSON.stringify(event), event: "analysis", id: String(id) });
      }
    });
  });
  app.post("/v2/study-captures", async (context) => {
    const owner = await options.authenticateWeb(context);
    const headers = writeHeadersSchema.parse({
      "idempotency-key": context.req.header("idempotency-key"),
    });
    const input = studyCaptureCreateRequestSchema.parse(await context.req.json<unknown>());
    context.header("Cache-Control", "private, no-store");
    return context.json(
      studyCaptureCreateResponseSchema.parse(
        await options.module.create(owner, input, headers["idempotency-key"]),
      ),
      201,
    );
  });
  app.post(studyCaptureHttpRoutes.create, async (context) => {
    const owner = await options.authenticateCreate(context);
    const headers = writeHeadersSchema.safeParse({
      "idempotency-key": context.req.header("idempotency-key"),
    });
    if (!headers.success) throw new CloudFault("invalid_request", "Idempotency-Key is required.");
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      throw new CloudFault("invalid_request", "Expected JSON.");
    }
    const input = studyCaptureCreateRequestSchema.parse(body);
    context.header("Cache-Control", "private, no-store");
    return context.json(
      studyCaptureCreateResponseSchema.parse(
        await options.module.create(owner, input, headers.data["idempotency-key"]),
      ),
      201,
    );
  });
  app.delete(studyCaptureHttpRoutes.detail, async (context) => {
    const owner = await options.authenticateDelete(context);
    const headers = revisionWriteHeadersSchema.safeParse({
      "idempotency-key": context.req.header("idempotency-key"),
      "if-match": context.req.header("if-match"),
    });
    if (!headers.success) throw new CloudFault("invalid_request", "Write proof is required.");
    const input = studyCaptureDeleteRequestSchema.parse(await context.req.json());
    const headerRevision = Number(headers.data["if-match"].slice(1, -1));
    if (headerRevision !== input.expectedRevision) {
      throw new CloudFault("invalid_request", "If-Match must match expectedRevision.");
    }
    return context.json(
      studyCaptureDeleteResponseSchema.parse(
        await options.module.delete(
          owner,
          context.req.param("id"),
          input,
          headers.data["idempotency-key"],
        ),
      ),
    );
  });
  app.get(studyCaptureHttpRoutes.list, async (context) => {
    const owner = await options.authenticateWeb(context);
    context.header("Cache-Control", "private, no-store");
    return context.json(
      studyCaptureListResponseSchema.parse(
        await options.module.list(owner, studyCaptureListQuerySchema.parse(context.req.query())),
      ),
    );
  });
  app.get(studyCaptureHttpRoutes.detail, async (context) => {
    const owner = await options.authenticateWeb(context);
    const detail = await options.module.get(owner, context.req.param("id"));
    if (detail === null) throw new CloudFault("not_found", "StudyCapture not found.");
    context.header("Cache-Control", "private, no-store");
    return context.json(studyCaptureDetailResponseSchema.parse(detail));
  });
  app.patch(studyCaptureHttpRoutes.detail, async (context) => {
    const owner = await options.authenticateWeb(context);
    const headers = revisionWriteHeadersSchema.safeParse({
      "idempotency-key": context.req.header("idempotency-key"),
      "if-match": context.req.header("if-match"),
    });
    if (!headers.success) throw new CloudFault("invalid_request", "Write proof is required.");
    const input = studyCapturePatchRequestSchema.parse(await context.req.json());
    if (Number(headers.data["if-match"].slice(1, -1)) !== input.expectedRevision) {
      throw new CloudFault("invalid_request", "If-Match must match expectedRevision.");
    }
    return context.json(
      studyCapturePatchResponseSchema.parse(
        await options.module.patch(
          owner,
          context.req.param("id"),
          input,
          headers.data["idempotency-key"],
        ),
      ),
    );
  });
  return app;
}
