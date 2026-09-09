import { Hono } from "hono";
import { vi } from "vitest";
import { createAccountDataRightsApp } from "../account-data-rights-app.js";
import { createAccountDataRightsModule } from "../account-data-rights-module.js";
import { createAccountDataRightsWorker } from "../account-data-rights-worker.js";
import type { AnalysisDatabase } from "../analysis-database.js";
import { authenticateDataRightsRequest } from "../data-rights-authentication.js";
import { createMiniProgramExportApp } from "../miniprogram-export-app.js";
import type { MiniProgramIdentity } from "../miniprogram-identity.js";
import { miniProgramToken } from "../miniprogram-token.js";
import { createPostgresAccountDataExportSource } from "../postgres-account-data-export-source.js";
import { createPostgresAccountDataRights } from "../postgres-account-data-rights.js";
import { createPostgresAccountDataRightsWorker } from "../postgres-account-data-rights-worker.js";
import type { createPostgresFoundationIdentity } from "../postgres-foundation-identity.js";
import { hashSecret, systemClock, systemSecrets } from "../security.js";
import { webSessionCookie } from "../web-session-cookie.js";

export function createJourneyDataRights(options: {
  database: AnalysisDatabase;
  web: ReturnType<typeof createPostgresFoundationIdentity>;
  mini: MiniProgramIdentity;
  pepper: string;
}) {
  const { database, web, mini, pepper } = options;
  const objects = new Map<string, Uint8Array>();
  const storageOrigin = "https://storage.example.test";
  const prefix = "/storage/v1/object/sign/private/";
  const signedUrls = {
    create: vi.fn(async (key: string) => ({ url: `${storageOrigin}${prefix}${key}?token=test` })),
  };
  const storageFetch = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = objects.get(url.pathname.slice(prefix.length));
    return body
      ? new Response(new TextDecoder().decode(body))
      : new Response(null, { status: 404 });
  });
  const authority = {
    deleteAuthUser: vi.fn<(owner: string) => Promise<void>>(async () => undefined),
    deleteObjects: vi.fn(async (keys: string[]) => {
      for (const key of keys) objects.delete(key);
    }),
    upload: vi.fn(async (key: string, body: Uint8Array) => {
      objects.set(key, body);
    }),
  };
  const module = createAccountDataRightsModule({
    now: systemClock.now,
    repository: createPostgresAccountDataRights(database, {
      id: () => crypto.randomUUID(),
      pepper,
    }),
    signedUrls,
  });
  const app = new Hono();
  app.route(
    "/",
    createMiniProgramExportApp({
      identity: mini,
      module,
      storageOrigin,
      bucket: "private",
      fetch: storageFetch,
    }),
  );
  app.route(
    "/",
    createAccountDataRightsApp({
      module,
      authenticate: async (context) => {
        if (context.req.header("authorization") !== undefined) {
          const auth = await mini.authenticate(
            miniProgramToken(context.req.header("authorization")),
          );
          return {
            ownerUserId: auth.userId,
            reauthenticatedAt: auth.reauthenticatedAt,
            requestSessionHash: auth.sessionHash,
          };
        }
        return authenticateDataRightsRequest(web, context, (value) => hashSecret(value, pepper));
      },
      requestSessionProof: (context) =>
        hashSecret(
          context.req.header("authorization") !== undefined
            ? miniProgramToken(context.req.header("authorization"))
            : (webSessionCookie(context) ?? "missing-session"),
          pepper,
        ),
    }),
  );
  const worker = createAccountDataRightsWorker({
    authority,
    exportSource: createPostgresAccountDataExportSource(database),
    now: systemClock.now,
    repository: createPostgresAccountDataRightsWorker(database, {
      clock: systemClock,
      secrets: systemSecrets,
      pepper,
    }),
  });
  return { app, authority, objects, signedUrls, storageFetch, worker };
}
