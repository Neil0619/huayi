import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";
import { createAccountDataRightsApp } from "./account-data-rights-app.js";
import {
  createAccountDataRightsModule,
  type AccountDataRightsRepository,
} from "./account-data-rights-module.js";

const job = {
  createdAt: "2026-08-13T01:00:00.000Z",
  formatVersion: 1 as const,
  id: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  state: "pending" as const,
  updatedAt: "2026-08-13T01:00:00.000Z",
};

function server() {
  const repository: AccountDataRightsRepository = {
    currentExport: vi.fn(async () => job),
    exportDownload: vi.fn(async () => ({
      expiresAt: "2026-08-14T01:00:00.000Z",
      objectKey: `account-exports/${job.id}.ndjson`,
    })),
    requestDeletion: vi.fn(async (command) => ({
      accepted: true as const,
      requestedAt: command.requestedAt,
    })),
    replayDeletion: vi.fn(async () => ({
      accepted: true as const,
      requestedAt: "2026-08-13T01:00:00.000Z",
    })),
    requestExport: vi.fn(async () => job),
    retryExport: vi.fn(async () => ({ ...job, revision: 2 })),
  };
  const authenticate = vi.fn(async () => ({
    ownerUserId: "user-1",
    reauthenticatedAt: new Date("2026-08-13T00:59:00.000Z"),
    requestSessionHash: "session-proof-hash",
  }));
  const inner = createAccountDataRightsApp({
    authenticate,
    module: createAccountDataRightsModule({
      now: () => new Date("2026-08-13T01:00:00.000Z"),
      repository,
      signedUrls: {
        create: vi.fn(async () => ({
          url: "https://project.supabase.co/storage/v1/object/sign/private/export?token=opaque",
        })),
      },
    }),
    requestSessionProof: () => "session-proof-hash",
  });
  const outer = new Hono();
  outer.onError((error, context) => {
    const fault =
      error instanceof CloudFault
        ? error
        : new CloudFault("invalid_request", "The request could not be completed.");
    return context.json(
      { error: { code: fault.code, message: fault.message, requestId: "request-1" } },
      errorStatus(fault.code),
    );
  });
  outer.route("/", inner);
  return { authenticate, outer, repository };
}

const proofHeaders = {
  "content-type": "application/json",
  "idempotency-key": "write-key",
  origin: "https://app.huayi.example",
  "x-csrf-token": "c".repeat(43),
};

describe("account data rights HTTP", () => {
  it("reads and creates the owner export with strict no-store responses", async () => {
    const { outer } = server();
    const current = await outer.request("/v1/account-data-exports/current");
    expect(current.status).toBe(200);
    expect(current.headers.get("cache-control")).toBe("private, no-store");
    expect(await current.json()).toEqual({ job });

    const created = await outer.request("/v1/account-data-exports", {
      body: "{}",
      headers: proofHeaders,
      method: "POST",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(job);
  });

  it("requires matching revision proof and returns only a one-shot signed URL", async () => {
    const { outer } = server();
    const mismatch = await outer.request(`/v1/account-data-exports/${job.id}/retry`, {
      body: JSON.stringify({ expectedRevision: 1 }),
      headers: { ...proofHeaders, "if-match": '"2"' },
      method: "POST",
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.headers.get("cache-control")).toBe("private, no-store");

    const retried = await outer.request(`/v1/account-data-exports/${job.id}/retry`, {
      body: JSON.stringify({ expectedRevision: 1 }),
      headers: { ...proofHeaders, "if-match": '"1"' },
      method: "POST",
    });
    expect(retried.status).toBe(200);
    const download = await outer.request(`/v1/account-data-exports/${job.id}/download-url`, {
      body: "{}",
      headers: proofHeaders,
      method: "POST",
    });
    expect(download.status).toBe(200);
    expect(await download.json()).toEqual({
      expiresAt: "2026-08-13T01:15:00.000Z",
      url: "https://project.supabase.co/storage/v1/object/sign/private/export?token=opaque",
    });
  });

  it("prevents caching authentication and request-validation failures", async () => {
    const { authenticate, outer } = server();
    authenticate.mockRejectedValueOnce(
      new CloudFault("authentication_required", "The data-rights session is invalid."),
    );
    const unauthorized = await outer.request("/v1/account-data-exports/current");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toBe("private, no-store");

    const invalid = await outer.request("/v1/account-data-exports", {
      body: JSON.stringify({ unexpected: true }),
      headers: proofHeaders,
      method: "POST",
    });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("private, no-store");
  });

  it("accepts deletion once and clears the browser session cookie", async () => {
    const { outer, repository } = server();
    const response = await outer.request("/v1/account-deletion", {
      body: JSON.stringify({ confirmation: "delete-account" }),
      headers: proofHeaders,
      method: "POST",
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("set-cookie")).toContain("huayi_session=;");
    expect(await response.json()).toEqual({
      accepted: true,
      requestedAt: "2026-08-13T01:00:00.000Z",
    });
    expect(repository.requestDeletion).toHaveBeenCalledOnce();
  });

  it("replays only the fixed deletion receipt after the request revoked authentication", async () => {
    const { authenticate, outer, repository } = server();
    const first = await outer.request("/v1/account-deletion", {
      body: JSON.stringify({ confirmation: "delete-account" }),
      headers: proofHeaders,
      method: "POST",
    });
    expect(first.status).toBe(202);
    authenticate.mockRejectedValueOnce(new CloudFault("authentication_required", "revoked"));
    const replay = await outer.request("/v1/account-deletion", {
      body: JSON.stringify({ confirmation: "delete-account" }),
      headers: proofHeaders,
      method: "POST",
    });
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual({
      accepted: true,
      requestedAt: "2026-08-13T01:00:00.000Z",
    });
    expect(repository.replayDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ requestSessionHash: "session-proof-hash" }),
    );
  });
});
