import {
  createLearningItemRequestSchema,
  createLearningItemResponseSchema,
  createLearningItemWriteHeadersSchema,
  deleteLearningItemRequestSchema,
  deleteLearningItemResponseSchema,
  duplicateSuggestionsHeadersSchema,
  duplicateSuggestionsRequestSchema,
  duplicateSuggestionsResponseSchema,
  learningItemDetailResponseSchema,
  learningItemArchiveRequestSchema,
  learningItemHttpRoutes,
  learningItemListResponseSchema,
  learningItemMergeResponseSchema,
  learningItemMutationHeadersSchema,
  listLearningItemsQuerySchema,
  mergeLearningItemsRequestSchema,
  mergePreviewResponseSchema,
  patchLearningItemRequestSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { LearningLibraryModule } from "./learning-library-module.js";
import type { LearningLibraryMaintenance } from "./learning-library-maintenance.js";

function mutationHeaders(context: Context, expectedRevision: number) {
  const headers = learningItemMutationHeadersSchema.parse({
    "idempotency-key": context.req.header("idempotency-key"),
    "if-match": context.req.header("if-match"),
  });
  if (Number(headers["if-match"].slice(1, -1)) !== expectedRevision) {
    throw new CloudFault("invalid_request", "If-Match must match expectedRevision.");
  }
  return headers;
}

export function createLearningLibraryApp(options: {
  authenticate(context: Context): Promise<string> | string;
  maintenance: LearningLibraryMaintenance;
  module: LearningLibraryModule;
}) {
  const app = new Hono();
  app.post(learningItemHttpRoutes.create, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const headers = createLearningItemWriteHeadersSchema.parse({
      "idempotency-key": context.req.header("idempotency-key"),
    });
    const input = createLearningItemRequestSchema.parse(await context.req.json());
    return context.json(
      createLearningItemResponseSchema.parse(
        await options.module.create(ownerUserId, headers["idempotency-key"], input),
      ),
      201,
    );
  });
  app.get(learningItemHttpRoutes.list, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const query = listLearningItemsQuerySchema.parse(context.req.query());
    return context.json(
      learningItemListResponseSchema.parse(await options.module.list(ownerUserId, query)),
    );
  });
  app.get(learningItemHttpRoutes.detail, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const found = await options.module.get(ownerUserId, context.req.param("id"));
    if (found === null) throw new CloudFault("not_found", "Learning item not found.");
    return context.json(learningItemDetailResponseSchema.parse(found));
  });
  app.patch(learningItemHttpRoutes.patch, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = patchLearningItemRequestSchema.parse(await context.req.json());
    const headers = mutationHeaders(context, input.expectedRevision);
    return context.json(
      learningItemDetailResponseSchema.parse(
        await options.maintenance.patch(
          ownerUserId,
          context.req.param("id"),
          headers["idempotency-key"],
          input,
        ),
      ),
    );
  });
  app.delete(learningItemHttpRoutes.delete, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = deleteLearningItemRequestSchema.parse(await context.req.json());
    const headers = mutationHeaders(context, input.expectedRevision);
    return context.json(
      deleteLearningItemResponseSchema.parse(
        await options.maintenance.delete(
          ownerUserId,
          context.req.param("id"),
          headers["idempotency-key"],
          input,
        ),
      ),
    );
  });
  for (const [route, operation] of [
    [learningItemHttpRoutes.archive, options.maintenance.archive],
    [learningItemHttpRoutes.restore, options.maintenance.restore],
  ] as const) {
    app.post(route, async (context) => {
      const ownerUserId = await options.authenticate(context);
      const input = learningItemArchiveRequestSchema.parse(await context.req.json());
      const headers = mutationHeaders(context, input.expectedRevision);
      return context.json(
        learningItemDetailResponseSchema.parse(
          await operation(ownerUserId, context.req.param("id"), headers["idempotency-key"], input),
        ),
      );
    });
  }
  app.post(learningItemHttpRoutes.duplicateSuggestions, async (context) => {
    context.header("Cache-Control", "private, no-store");
    const ownerUserId = await options.authenticate(context);
    const ifMatch = context.req.header("if-match");
    const headers = duplicateSuggestionsHeadersSchema.parse({
      "idempotency-key": context.req.header("idempotency-key"),
      ...(ifMatch === undefined ? {} : { "if-match": ifMatch }),
    });
    const input = duplicateSuggestionsRequestSchema.parse(await context.req.json());
    return context.json(
      duplicateSuggestionsResponseSchema.parse(
        await options.maintenance.suggestions(
          ownerUserId,
          context.req.param("id"),
          headers["idempotency-key"],
          input,
        ),
      ),
    );
  });
  app.post(learningItemHttpRoutes.mergePreview, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = mergeLearningItemsRequestSchema.parse(await context.req.json());
    return context.json(
      mergePreviewResponseSchema.parse(
        await options.maintenance.previewMerge(ownerUserId, context.req.param("id"), input),
      ),
    );
  });
  app.post(learningItemHttpRoutes.mergeConfirm, async (context) => {
    const ownerUserId = await options.authenticate(context);
    const input = mergeLearningItemsRequestSchema.parse(await context.req.json());
    const headers = mutationHeaders(context, input.sourceRevision);
    return context.json(
      learningItemMergeResponseSchema.parse(
        await options.maintenance.confirmMerge(
          ownerUserId,
          context.req.param("id"),
          headers["idempotency-key"],
          input,
        ),
      ),
    );
  });
  return app;
}
