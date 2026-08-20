import {
  accountDataExportCreateHeadersSchema,
  accountDataExportJobResourceSchema,
  accountDataExportRetryHeadersSchema,
  accountDataRightsHttpRoutes,
  accountDeletionHeadersSchema,
  accountDeletionRequestSchema,
  accountDeletionResponseSchema,
  createAccountDataExportRequestSchema,
  currentAccountDataExportResponseSchema,
  downloadAccountDataExportResponseSchema,
  resourceIdSchema,
  retryAccountDataExportRequestSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { AccountDataRightsModule } from "./account-data-rights-module.js";

export interface AccountDataRightsPrincipal {
  ownerUserId: string;
  reauthenticatedAt: Date;
  requestSessionHash: string;
}

async function jsonBody(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new CloudFault("invalid_request", "Expected JSON.");
  }
}

function id(context: Context): string {
  return resourceIdSchema.parse(context.req.param("id"));
}

function createKey(context: Context): string {
  return accountDataExportCreateHeadersSchema.parse({
    "idempotency-key": context.req.header("idempotency-key"),
  })["idempotency-key"];
}

function revisionKey(context: Context, expectedRevision: number): string {
  const headers = accountDataExportRetryHeadersSchema.parse({
    "idempotency-key": context.req.header("idempotency-key"),
    "if-match": context.req.header("if-match"),
  });
  if (Number(headers["if-match"].slice(1, -1)) !== expectedRevision) {
    throw new CloudFault("invalid_request", "If-Match must match expectedRevision.");
  }
  return headers["idempotency-key"];
}

function noStore(context: Context): void {
  context.header("Cache-Control", "private, no-store");
}

export function createAccountDataRightsApp(options: {
  authenticate(context: Context): AccountDataRightsPrincipal | Promise<AccountDataRightsPrincipal>;
  module: AccountDataRightsModule;
  requestSessionProof?(context: Context): string;
}) {
  const app = new Hono();
  app.get(accountDataRightsHttpRoutes.currentExport, async (context) => {
    const principal = await options.authenticate(context);
    noStore(context);
    return context.json(
      currentAccountDataExportResponseSchema.parse({
        job: await options.module.currentExport(principal.ownerUserId),
      }),
    );
  });
  app.post(accountDataRightsHttpRoutes.createExport, async (context) => {
    const principal = await options.authenticate(context);
    const input = createAccountDataExportRequestSchema.parse(await jsonBody(context));
    noStore(context);
    return context.json(
      accountDataExportJobResourceSchema.parse(
        await options.module.requestExport(principal.ownerUserId, createKey(context), input),
      ),
      201,
    );
  });
  app.post(accountDataRightsHttpRoutes.retryExport, async (context) => {
    const principal = await options.authenticate(context);
    const input = retryAccountDataExportRequestSchema.parse(await jsonBody(context));
    noStore(context);
    return context.json(
      accountDataExportJobResourceSchema.parse(
        await options.module.retryExport(
          principal.ownerUserId,
          id(context),
          revisionKey(context, input.expectedRevision),
          input,
        ),
      ),
    );
  });
  app.post(accountDataRightsHttpRoutes.downloadExport, async (context) => {
    const principal = await options.authenticate(context);
    createAccountDataExportRequestSchema.parse(await jsonBody(context));
    noStore(context);
    return context.json(
      downloadAccountDataExportResponseSchema.parse(
        await options.module.createDownload(
          principal.ownerUserId,
          id(context),
          principal.reauthenticatedAt,
        ),
      ),
    );
  });
  app.post(accountDataRightsHttpRoutes.deleteAccount, async (context) => {
    const input = accountDeletionRequestSchema.parse(await jsonBody(context));
    const key = accountDeletionHeadersSchema.parse({
      "idempotency-key": context.req.header("idempotency-key"),
    })["idempotency-key"];
    let response;
    try {
      const principal = await options.authenticate(context);
      response = await options.module.requestDeletion(
        principal.ownerUserId,
        key,
        principal.requestSessionHash,
        principal.reauthenticatedAt,
        input,
      );
    } catch (error) {
      const proof = options.requestSessionProof?.(context);
      const replay =
        proof === undefined ? null : await options.module.replayDeletion(key, proof, input);
      if (replay === null) throw error;
      response = replay;
    }
    response = accountDeletionResponseSchema.parse(response);
    noStore(context);
    context.header(
      "Set-Cookie",
      "huayi_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    );
    return context.json(response, 202);
  });
  return app;
}
