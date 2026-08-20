import {
  deleteWordEntryRequestSchema,
  deleteWordEntryResponseSchema,
  listWordEntriesQuerySchema,
  patchWordEntryRequestSchema,
  patchWordEntryResponseSchema,
  upsertWordRequestSchema,
  upsertWordResponseSchema,
  wordEntryCreateHeadersSchema,
  wordEntryDetailQuerySchema,
  wordEntryDetailResponseSchema,
  wordEntryHttpRoutes,
  wordEntryListResponseSchema,
  wordEntryMutationHeadersSchema,
  wordListExportHeadersSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { WordLibraryModule } from "./word-library-module.js";
import type { WordListExport } from "./word-list-export.js";

function headers(context: Context, revision: number) {
  const parsed = wordEntryMutationHeadersSchema.parse({
    "idempotency-key": context.req.header("idempotency-key"),
    "if-match": context.req.header("if-match"),
  });
  if (Number(parsed["if-match"].slice(1, -1)) !== revision) {
    throw new CloudFault("invalid_request", "If-Match must match expectedRevision.");
  }
  return parsed["idempotency-key"];
}

export function createWordLibraryApp(options: {
  authenticate(context: Context): Promise<string> | string;
  exportWords?: WordListExport | undefined;
  module: WordLibraryModule;
}) {
  const app = new Hono();
  if (options.exportWords !== undefined) {
    const exportWords = options.exportWords;
    app.get(wordEntryHttpRoutes.export, async (context) => {
      const owner = await options.authenticate(context);
      const headers = wordListExportHeadersSchema.parse({
        "content-disposition": 'attachment; filename="huayi-words.txt"',
        "content-type": "text/plain; charset=utf-8",
      });
      return context.body(await exportWords.text(owner), 200, headers);
    });
  }
  app.post(wordEntryHttpRoutes.create, async (context) => {
    const owner = await options.authenticate(context);
    const input = upsertWordRequestSchema.parse(await context.req.json());
    const write = wordEntryCreateHeadersSchema.parse({
      "idempotency-key": context.req.header("idempotency-key"),
    });
    return context.json(
      upsertWordResponseSchema.parse(
        await options.module.upsert(owner, write["idempotency-key"], input),
      ),
    );
  });
  app.get(wordEntryHttpRoutes.list, async (context) => {
    const owner = await options.authenticate(context);
    return context.json(
      wordEntryListResponseSchema.parse(
        await options.module.list(owner, listWordEntriesQuerySchema.parse(context.req.query())),
      ),
    );
  });
  app.get(wordEntryHttpRoutes.detail, async (context) => {
    const owner = await options.authenticate(context);
    const found = await options.module.get(
      owner,
      context.req.param("id"),
      wordEntryDetailQuerySchema.parse(context.req.query()),
    );
    if (found === null) throw new CloudFault("not_found", "Word entry not found.");
    return context.json(wordEntryDetailResponseSchema.parse(found));
  });
  app.patch(wordEntryHttpRoutes.patch, async (context) => {
    const owner = await options.authenticate(context);
    const input = patchWordEntryRequestSchema.parse(await context.req.json());
    return context.json(
      patchWordEntryResponseSchema.parse(
        await options.module.patch(
          owner,
          context.req.param("id"),
          headers(context, input.expectedRevision),
          input,
        ),
      ),
    );
  });
  app.delete(wordEntryHttpRoutes.delete, async (context) => {
    const owner = await options.authenticate(context);
    const input = deleteWordEntryRequestSchema.parse(await context.req.json());
    return context.json(
      deleteWordEntryResponseSchema.parse(
        await options.module.delete(
          owner,
          context.req.param("id"),
          headers(context, input.expectedRevision),
          input,
        ),
      ),
    );
  });
  return app;
}
