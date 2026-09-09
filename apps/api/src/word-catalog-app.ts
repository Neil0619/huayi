import { Hono, type Context } from "hono";
import {
  resourceIdSchema,
  wordArchiveRequestSchema,
  wordCatalogDetailSchema,
  wordCatalogRoutes,
  wordEntryDetailQuerySchema,
  wordEntryMutationHeadersSchema,
} from "@huayi/cloud-contracts";
import type { createWordCatalog } from "./word-catalog.js";
import type { WordLibraryModule } from "./word-library-module.js";
import { CloudFault } from "./cloud-fault.js";
import { readRevisionHeader } from "./revision-header.js";
export function createWordCatalogApp(options: {
  authenticate(context: Context): Promise<string> | string;
  catalog: ReturnType<typeof createWordCatalog>;
  words: WordLibraryModule;
}) {
  const app = new Hono();
  app.get(wordCatalogRoutes.list, async (context) =>
    context.json(
      await options.catalog.list(await options.authenticate(context), context.req.query()),
    ),
  );
  app.get(wordCatalogRoutes.detail, async (context) => {
    const owner = await options.authenticate(context);
    const id = resourceIdSchema.parse(context.req.param("id"));
    const detail = await options.words.get(
      owner,
      id,
      wordEntryDetailQuerySchema.parse(context.req.query()),
    );
    if (!detail) throw new CloudFault("not_found", "Word entry not found.");
    const state = await options.catalog.state(owner, id);
    return context.json(
      wordCatalogDetailSchema.parse({ ...detail, word: state.word, archivedAt: state.archivedAt }),
    );
  });
  app.post(wordCatalogRoutes.archive, async (context) => {
    const owner = await options.authenticate(context);
    const id = resourceIdSchema.parse(context.req.param("id"));
    const input = wordArchiveRequestSchema.parse(await context.req.json());
    const headers = wordEntryMutationHeadersSchema.parse({
      "idempotency-key": context.req.header("idempotency-key"),
      "if-match": readRevisionHeader(context),
    });
    if (Number(headers["if-match"].slice(1, -1)) !== input.expectedRevision)
      throw new CloudFault("invalid_request", "Revision header must match.");
    return context.json(
      await options.catalog.archive(owner, id, headers["idempotency-key"], input),
    );
  });
  return app;
}
