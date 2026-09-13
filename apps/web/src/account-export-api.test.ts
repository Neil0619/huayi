import { expect, it, vi } from "vitest";
import { createWebIdentityApi } from "./identity-api.js";
import { readLatestAccountExport } from "./account-export-api.js";
import { accountDataExportJobReadResourceSchema } from "@huayi/cloud-contracts";

const time = "2026-09-13T00:00:00.000Z";
const csrf = "c".repeat(43);
const job = (formatVersion = 3) => ({
  id: "export-id",
  formatVersion,
  revision: 1,
  state: "pending",
  createdAt: time,
  updatedAt: time,
});
it("explicitly requests a full teaching export and pins create/current/retry/download format", async () => {
  const requests: { path: string; input: RequestInit | undefined }[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, input?: RequestInit) => {
    const path = new URL(String(url)).pathname + new URL(String(url)).search;
    requests.push({ path, input });
    return Response.json(
      path.endsWith("download-url")
        ? { url: "https://storage.example.test/file", expiresAt: time }
        : path.includes("current")
          ? { job: job() }
          : job(),
    );
  });
  const api = createWebIdentityApi({ apiOrigin: "https://api.example.test", fetch });
  expect((await api.createAccountDataExport(csrf, 3)).formatVersion).toBe(3);
  expect((await api.getCurrentAccountDataExport(3)).job?.formatVersion).toBe(3);
  await api.retryAccountDataExport("export-id", 1, csrf, 3);
  await api.downloadAccountDataExport("export-id", csrf, 3);
  expect(requests.map((r) => [r.path, r.input?.body && JSON.parse(String(r.input.body))])).toEqual([
    ["/v1/account-data-exports", { formatVersion: 3 }],
    ["/v1/account-data-exports/current?formatVersion=3", undefined],
    ["/v1/account-data-exports/export-id/retry", { expectedRevision: 1, formatVersion: 3 }],
    ["/v1/account-data-exports/export-id/download-url", { formatVersion: 3 }],
  ]);
  for (const request of requests) expect(request.input?.credentials).toBe("include");
});

it("keeps default format 1 request bytes and rejects a server format mismatch", async () => {
  const fetch = vi.fn<(url: RequestInfo | URL, input?: RequestInit) => Promise<Response>>(
    async () => Response.json(job(1)),
  );
  const api = createWebIdentityApi({ apiOrigin: "https://api.example.test", fetch });
  await api.createAccountDataExport(csrf);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ body: "{}" });
  await expect(api.createAccountDataExport(csrf, 3)).rejects.toThrow();
});
it("keeps an existing active compatibility job visible across the three formats", async () => {
  const active = accountDataExportJobReadResourceSchema.parse(job(2));
  const failed = accountDataExportJobReadResourceSchema.parse({
    ...job(),
    state: "failed",
    stableErrorCode: "export-build-failed",
    createdAt: "2026-09-14T00:00:00Z",
  });
  const read = vi.fn(async (format: 1 | 2 | 3) => ({
    job: format === 2 ? active : format === 3 ? failed : null,
  }));
  expect(await readLatestAccountExport(read)).toEqual({ job: active });
  expect(read.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
});
