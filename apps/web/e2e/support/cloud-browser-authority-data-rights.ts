import type { Request, Route } from "@playwright/test";
import {
  accountDataExportJobResourceSchema,
  accountDeletionRequestSchema,
  accountDeletionResponseSchema,
  createAccountDataExportRequestSchema,
  currentAccountDataExportResponseSchema,
  downloadAccountDataExportResponseSchema,
  type AccountDataExportJobResource,
  type ApiError,
} from "@huayi/cloud-contracts";

import { cloudCors, cloudRequestBody } from "./cloud-browser-authority-request.js";
import type {
  CloudBrowserAuthenticatedAs,
  CloudBrowserRequestFact,
} from "./cloud-browser-authority-types.js";

const now = "2026-08-13T10:00:00.000Z";
const readyAt = "2026-08-13T10:01:00.000Z";
const expiresAt = "2026-08-14T10:00:00.000Z";
const signedUrl = "https://download.huayi.invalid/account-export.txt?token=private-download-token";

interface DataRightsAuthorityContext {
  readonly authentication: (request: Request) => CloudBrowserAuthenticatedAs;
  readonly json: (route: Route, status: number, body: unknown) => Promise<void>;
  readonly mutationProof: (request: Request, revision?: number) => boolean;
  readonly record: (request: Request, proof: CloudBrowserRequestFact["proof"]) => void;
  readonly reject: (
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ) => Promise<void>;
  readonly writeProof: (request: Request, revision?: number) => string | null;
}

function pendingJob(): AccountDataExportJobResource {
  return accountDataExportJobResourceSchema.parse({
    createdAt: now,
    formatVersion: 1,
    id: "export-1",
    revision: 1,
    state: "pending",
    updatedAt: now,
  });
}

function readyJob(): AccountDataExportJobResource {
  return accountDataExportJobResourceSchema.parse({
    byteLength: 1_024,
    createdAt: now,
    expiresAt,
    formatVersion: 1,
    id: "export-1",
    recordCount: 8,
    revision: 2,
    state: "ready",
    updatedAt: readyAt,
  });
}

export function createCloudBrowserDataRightsAuthority() {
  let job: AccountDataExportJobResource | null = null;

  return {
    async handle(route: Route, context: DataRightsAuthorityContext): Promise<boolean> {
      const request = route.request();
      const url = new URL(request.url());
      const isCurrent =
        url.pathname === "/v1/account-data-exports/current" && request.method() === "GET";
      const isCreate = url.pathname === "/v1/account-data-exports" && request.method() === "POST";
      const downloadMatch = /^\/v1\/account-data-exports\/([^/]+)\/download-url$/u.exec(
        url.pathname,
      );
      const isDeletion = url.pathname === "/v1/account-deletion" && request.method() === "POST";
      if (!isCurrent && !isCreate && downloadMatch === null && !isDeletion) return false;

      if (context.authentication(request) !== "web") {
        await context.reject(
          route,
          401,
          "authentication_required",
          request.method() === "GET" ? "read" : "write-invalid",
        );
        return true;
      }
      if (isCurrent) {
        if (job?.state === "pending") job = readyJob();
        context.record(request, "read");
        await context.json(route, 200, currentAccountDataExportResponseSchema.parse({ job }));
        return true;
      }
      if (isCreate) {
        const parsed = createAccountDataExportRequestSchema.safeParse(cloudRequestBody(request));
        if (!parsed.success || context.writeProof(request) === null) {
          await context.reject(
            route,
            parsed.success ? 403 : 400,
            parsed.success ? "forbidden" : "invalid_request",
          );
          return true;
        }
        job = pendingJob();
        context.record(request, "write-valid");
        await context.json(route, 202, job);
        return true;
      }
      if (downloadMatch?.[1] !== undefined && request.method() === "POST") {
        const parsed = createAccountDataExportRequestSchema.safeParse(cloudRequestBody(request));
        if (!parsed.success || !context.mutationProof(request)) {
          await context.reject(
            route,
            parsed.success ? 403 : 400,
            parsed.success ? "forbidden" : "invalid_request",
          );
          return true;
        }
        if (job?.state !== "ready" || decodeURIComponent(downloadMatch[1]) !== job.id) {
          await context.reject(route, 404, "not_found", "write-valid");
          return true;
        }
        context.record(request, "write-valid");
        await context.json(
          route,
          200,
          downloadAccountDataExportResponseSchema.parse({ expiresAt: readyAt, url: signedUrl }),
        );
        return true;
      }

      const parsed = accountDeletionRequestSchema.safeParse(cloudRequestBody(request));
      if (!parsed.success || context.writeProof(request) === null) {
        await context.reject(
          route,
          parsed.success ? 403 : 400,
          parsed.success ? "forbidden" : "invalid_request",
        );
        return true;
      }
      context.record(request, "write-valid");
      const headers = cloudCors(request.headers().origin) ?? {};
      await route.fulfill({
        body: JSON.stringify(
          accountDeletionResponseSchema.parse({ accepted: true, requestedAt: now }),
        ),
        contentType: "application/json; charset=utf-8",
        headers: {
          ...headers,
          "set-cookie": "huayi_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax",
        },
        status: 202,
      });
      return true;
    },
  };
}
