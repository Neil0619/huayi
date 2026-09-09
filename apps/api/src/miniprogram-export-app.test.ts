import { expect, it, vi } from "vitest";
import { createMiniProgramExportApp } from "./miniprogram-export-app.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";
const id = "10000000-0000-4000-8000-000000000001";
function setup(
  url = "https://storage.example/storage/v1/object/sign/private/account-exports/owner/data.ndjson?token=signed",
) {
  const authenticate = vi.fn(async () => ({
    userId: "owner",
    sessionHash: "hash",
    reauthenticatedAt: new Date(),
  }));
  const createDownload = vi.fn(async () => ({ url, expiresAt: "2026-09-10T00:00:00Z" }));
  const fetch = vi.fn(async () => new Response('{"recordType":"profile"}\n'));
  const app = createMiniProgramExportApp({
    identity: { authenticate },
    module: { createDownload },
    storageOrigin: "https://storage.example",
    bucket: "private",
    fetch,
  });
  app.onError((error, context) =>
    context.json(
      { error: error instanceof CloudFault ? error.code : "unknown" },
      error instanceof CloudFault ? errorStatus(error.code) : 500,
    ),
  );
  return { app, authenticate, createDownload, fetch };
}
it("keeps signed storage credentials server-side and streams a private authenticated download", async () => {
  const { app, createDownload, fetch } = setup();
  const response = await app.request(`/v1/miniprogram/data-exports/${id}/content`, {
    headers: { Authorization: `HuayiMiniProgram ${"x".repeat(43)}` },
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("profile");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("location")).toBeNull();
  expect(createDownload).toHaveBeenCalledWith("owner", id, expect.any(Date));
  expect(fetch).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({ redirect: "error" }),
  );
});
it("does not accept Web cookies in the mini download route", async () => {
  const { app, authenticate, fetch } = setup();
  expect(
    (
      await app.request(`/v1/miniprogram/data-exports/${id}/content`, {
        headers: { Cookie: "huayi_session=web" },
      })
    ).status,
  ).toBe(403);
  expect(authenticate).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  "https://attacker.example/storage/v1/object/sign/private/account-exports/data",
  "https://storage.example/storage/v1/object/public/private/account-exports/data",
  "http://storage.example/storage/v1/object/sign/private/account-exports/data",
])("rejects an unexpected download authority: %s", async (url) => {
  const { app, fetch } = setup(url);
  expect(
    (
      await app.request(`/v1/miniprogram/data-exports/${id}/content`, {
        headers: { Authorization: `HuayiMiniProgram ${"x".repeat(43)}` },
      })
    ).status,
  ).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it("requires the owner's export and a recent proof before storage is contacted", async () => {
  const { app, createDownload, fetch } = setup();
  createDownload.mockRejectedValue(new CloudFault("not_found", "No export."));
  expect(
    (
      await app.request(`/v1/miniprogram/data-exports/${id}/content`, {
        headers: { Authorization: `HuayiMiniProgram ${"x".repeat(43)}` },
      })
    ).status,
  ).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
