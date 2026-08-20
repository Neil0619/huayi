import type { Request, Route } from "@playwright/test";
import {
  createWordbookJobRequestSchema,
  idempotencyKeySchema,
  listWordbookJobsQuerySchema,
  submitWordbookReceiptsRequestSchema,
  wordbookJobListResponseSchema,
  wordbookJobResourceSchema,
  wordbookJobRevisionRequestSchema,
  wordbookLeaseRequestSchema,
  wordbookLeaseResponseSchema,
  wordbookReceiptResponseSchema,
  type ApiError,
  type WordbookJobResource,
} from "@huayi/cloud-contracts";

import { cloudQueryObject, cloudRequestBody } from "./cloud-browser-authority-request.js";
import type {
  CloudBrowserAuthenticatedAs,
  CloudBrowserRequestFact,
} from "./cloud-browser-authority-types.js";

interface WordSnapshotAuthority {
  exportEntries(): readonly { contextLine?: string; headword: string }[];
  importEudic(
    entries: readonly { addedAt: string; contextLine?: string; headword: string }[],
  ): void;
}

interface WordbookAuthorityContext {
  authentication(request: Request): CloudBrowserAuthenticatedAs;
  json(route: Route, status: number, body: unknown): Promise<void>;
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ): Promise<void>;
  writeProof(request: Request, revision?: number): string | null;
}

interface StoredJob {
  entries: readonly { contextLine?: string; headword: string; itemId: string }[];
  leaseToken: string | null;
  resource: WordbookJobResource;
}

const now = "2026-08-13T10:00:00.000Z";
const leaseExpiresAt = "2026-08-13T10:05:00.000Z";
const leaseToken = "wordbook-e2e-lease-token-000000000000000000000";

function extensionWrite(request: Request, context: WordbookAuthorityContext): boolean {
  return (
    context.authentication(request) === "extension" &&
    request.headers()["x-huayi-client-version"] === "1.0.0"
  );
}

export function createCloudBrowserWordbookAuthority(words: WordSnapshotAuthority) {
  const jobs = new Map<string, StoredJob>();
  let nextJobSequence = 0;

  const replace = (stored: StoredJob, update: Partial<WordbookJobResource>) => {
    stored.resource = wordbookJobResourceSchema.parse({
      ...stored.resource,
      ...update,
      revision: stored.resource.revision + 1,
      updatedAt: now,
    });
  };

  return {
    count: () => jobs.size,
    async handle(route: Route, context: WordbookAuthorityContext): Promise<boolean> {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/v1/wordbook-jobs" && request.method() === "GET") {
        const parsed = listWordbookJobsQuerySchema.safeParse(cloudQueryObject(url));
        if (context.authentication(request) === "none" || !parsed.success) {
          await context.reject(route, 403, "forbidden", "read");
          return true;
        }
        let items = [...jobs.values()].map((item) => item.resource);
        if (parsed.data.target !== undefined) {
          items = items.filter((item) => item.target === parsed.data.target);
        }
        if (parsed.data.direction !== undefined) {
          items = items.filter((item) => item.direction === parsed.data.direction);
        }
        if (parsed.data.state !== undefined) {
          items = items.filter((item) => item.state === parsed.data.state);
        }
        context.record(request, "read");
        await context.json(
          route,
          200,
          wordbookJobListResponseSchema.parse({
            items: items.slice(0, parsed.data.limit),
            nextCursor: null,
          }),
        );
        return true;
      }

      if (url.pathname === "/v1/wordbook-jobs" && request.method() === "POST") {
        const parsed = createWordbookJobRequestSchema.safeParse(cloudRequestBody(request));
        const authenticated = context.authentication(request);
        const proof =
          authenticated === "web"
            ? context.writeProof(request)
            : authenticated === "extension" &&
                idempotencyKeySchema.safeParse(request.headers()["idempotency-key"]).success
              ? request.headers()["idempotency-key"]
              : null;
        if (!parsed.success || proof === null) {
          await context.reject(route, 403, "forbidden");
          return true;
        }
        const sequence = ++nextJobSequence;
        const id = `30000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
        const entries =
          parsed.data.direction === "export"
            ? words.exportEntries().map((entry, index) => ({
                ...entry,
                itemId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
              }))
            : [];
        const resource = wordbookJobResourceSchema.parse({
          createdAt: now,
          direction: parsed.data.direction,
          failedCount: 0,
          id,
          lastErrorCode: null,
          nextPage: parsed.data.direction === "import" ? 0 : null,
          processedCount: 0,
          revision: 1,
          state:
            entries.length === 0 && parsed.data.direction === "export" ? "completed" : "pending",
          target: parsed.data.target,
          totalCount: parsed.data.direction === "export" ? entries.length : null,
          updatedAt: now,
        });
        jobs.set(id, { entries, leaseToken: null, resource });
        context.record(request, "write-valid");
        await context.json(route, 201, resource);
        return true;
      }

      const match = /^\/v1\/wordbook-jobs\/([^/]+)\/(cancel|lease|receipts|retry)$/u.exec(
        url.pathname,
      );
      if (match === null) return false;
      const stored = jobs.get(match[1] ?? "");
      if (stored === undefined) {
        await context.reject(route, 404, "not_found");
        return true;
      }
      const action = match[2];
      if ((action === "cancel" || action === "retry") && request.method() === "POST") {
        const parsed = wordbookJobRevisionRequestSchema.safeParse(cloudRequestBody(request));
        if (!parsed.success || context.writeProof(request, parsed.data.expectedRevision) === null) {
          await context.reject(route, 403, "forbidden");
          return true;
        }
        if (parsed.data.expectedRevision !== stored.resource.revision) {
          await context.reject(route, 409, "revision_conflict", "write-valid");
          return true;
        }
        if (action === "cancel") {
          if (!["active", "failed", "pending"].includes(stored.resource.state)) {
            await context.reject(route, 409, "wordbook_job_not_claimable", "write-valid");
            return true;
          }
          replace(stored, { lastErrorCode: null, state: "cancelled" });
        } else {
          if (stored.resource.state !== "failed") {
            await context.reject(route, 409, "wordbook_job_not_claimable", "write-valid");
            return true;
          }
          stored.leaseToken = null;
          replace(stored, { failedCount: 0, lastErrorCode: null, state: "pending" });
        }
        context.record(request, "write-valid");
        await context.json(route, 200, stored.resource);
        return true;
      }
      if (!extensionWrite(request, context)) {
        await context.reject(route, 403, "forbidden");
        return true;
      }
      if (action === "lease" && request.method() === "POST") {
        const parsed = wordbookLeaseRequestSchema.safeParse(cloudRequestBody(request));
        if (!parsed.success || parsed.data.expectedRevision !== stored.resource.revision) {
          await context.reject(route, 409, "revision_conflict");
          return true;
        }
        stored.leaseToken = leaseToken;
        replace(stored, { state: "active" });
        const response =
          stored.resource.direction === "import"
            ? {
                expiresAt: leaseExpiresAt,
                jobId: stored.resource.id,
                kind: "eudic-import" as const,
                leaseToken,
                page: stored.resource.nextPage ?? 0,
                pageSize: 100 as const,
              }
            : {
                entries: stored.entries,
                expiresAt: leaseExpiresAt,
                jobId: stored.resource.id,
                kind: "export" as const,
                leaseToken,
              };
        context.record(request, "write-valid");
        await context.json(route, 200, wordbookLeaseResponseSchema.parse(response));
        return true;
      }
      if (action === "receipts" && request.method() === "POST") {
        const parsed = submitWordbookReceiptsRequestSchema.safeParse(cloudRequestBody(request));
        if (
          !parsed.success ||
          parsed.data.leaseToken !== stored.leaseToken ||
          !idempotencyKeySchema.safeParse(request.headers()["idempotency-key"]).success
        ) {
          await context.reject(route, 409, "wordbook_lease_stale");
          return true;
        }
        if (parsed.data.kind === "export") {
          const failed = parsed.data.receipts.filter((item) => item.outcome === "failed");
          const failedCount = failed.length;
          replace(stored, {
            failedCount,
            lastErrorCode: failed[0]?.stableErrorCode ?? null,
            processedCount: parsed.data.receipts.length - failedCount,
            state:
              stored.resource.state === "cancelled"
                ? "cancelled"
                : failedCount === 0
                  ? "completed"
                  : "failed",
          });
        } else if (parsed.data.kind === "eudic-import-page") {
          if (stored.resource.state === "cancelled") {
            replace(stored, {});
          } else {
            words.importEudic(
              parsed.data.entries.map((entry) =>
                entry.contextLine === undefined
                  ? { addedAt: entry.addedAt, headword: entry.headword }
                  : {
                      addedAt: entry.addedAt,
                      contextLine: entry.contextLine,
                      headword: entry.headword,
                    },
              ),
            );
            replace(stored, {
              nextPage:
                parsed.data.entries.length < 100
                  ? stored.resource.nextPage
                  : (stored.resource.nextPage ?? 0) + 1,
              processedCount: stored.resource.processedCount + parsed.data.entries.length,
              state: parsed.data.entries.length < 100 ? "completed" : "pending",
            });
          }
        } else {
          replace(
            stored,
            stored.resource.state === "cancelled"
              ? {}
              : { lastErrorCode: parsed.data.stableErrorCode, state: "failed" },
          );
        }
        stored.leaseToken = null;
        context.record(request, "write-valid");
        await context.json(
          route,
          200,
          wordbookReceiptResponseSchema.parse({ job: stored.resource }),
        );
        return true;
      }
      return false;
    },
  };
}
