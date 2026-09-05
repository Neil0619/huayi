import type { AnalysisResult } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCloudIdentityApi } from "./cloud-identity-api.js";
import { createExtensionPreferenceCache } from "./extension-preference-cache.js";
import type { StoredExtensionSession } from "./extension-session-vault.js";
import { createQueryRouter } from "./query-router.js";

afterEach(() => vi.unstubAllGlobals());
const origin = `chrome-extension://${"a".repeat(32)}`;
const original: StoredExtensionSession = {
  token: "t".repeat(43),
  expiresAt: "2026-12-01T00:00:00.000Z",
  preferences: {
    extensionQueryModelMode: "platform",
    studyCaptureMode: "manual",
    cloudWordCopyMode: "disabled",
    revision: 1,
    updatedAt: "2026-09-04T00:00:00.000Z",
  },
};
const result: AnalysisResult = {
  requestId: "query-1",
  sourceText: "The plan fell through.",
  selectionKind: "sentence",
  translationZh: "计划落空了。",
  type: "translate-passage",
};

function setup(status = 200, expiresAt = original.expiresAt) {
  vi.stubGlobal("location", { origin });
  let session: StoredExtensionSession | null = { ...original, expiresAt };
  const vault = {
    clearSession: vi.fn(async () => {
      session = null;
    }),
    readSession: async () => session,
    writeSession: async (value: StoredExtensionSession) => {
      session = value;
    },
  };
  const api = createCloudIdentityApi({
    apiOrigin: "https://api.huayi.invalid",
    clientVersion: "1.0.0",
    fetch: async (_input, init) => {
      // Reproduce the API's fixed extension-origin requirement on a GET, for
      // which the browser does not automatically supply Origin.
      const actual = new Headers(init?.headers).get("Origin") === origin ? status : 403;
      return actual === 200
        ? Response.json(original.preferences)
        : Response.json(
            {
              error: {
                code:
                  actual === 401
                    ? "authentication_required"
                    : actual === 426
                      ? "client_upgrade_required"
                      : "forbidden",
                message: "safe fixture failure",
                requestId: "fixture-1",
              },
            },
            { status: actual },
          );
    },
  });
  const clearAccountData = vi.fn(async () => undefined);
  const preferences = createExtensionPreferenceCache({
    api,
    clearAccountData,
    vault,
    now: () => Date.parse("2026-09-04T01:00:00.000Z"),
  });
  const byok = { analyze: vi.fn(async () => result) };
  const platform = { analyze: vi.fn(async () => result) };
  const router = createQueryRouter({
    byok,
    platform,
    readPreferences: preferences.read,
    syncPreferences: preferences.sync,
  });
  const analyze = () =>
    router.analyze(
      {
        action: "translate",
        providerId: "deepseek",
        requestId: "query-1",
        selection: result.sourceText,
        selectionKind: "sentence",
        sentenceContext: null,
        targetLanguage: "zh-CN",
      },
      new AbortController().signal,
      () => undefined,
    );
  return { analyze, byok, platform, clearAccountData, session: () => session };
}

describe("translation keeps account failures separate from a missing BYOK key", () => {
  it("sends extension Origin when syncing preferences and keeps the paired platform query connected", async () => {
    const context = setup();
    await expect(context.analyze()).resolves.toEqual(result);
    expect(context.session()?.token).toBe(original.token);
    expect(context.byok.analyze).not.toHaveBeenCalled();
    expect(context.clearAccountData).not.toHaveBeenCalled();
  });

  it.each([
    [401, "cloud-session-required", false],
    [403, "cloud-access-denied", true],
    [426, "version-mismatch", true],
  ] as const)("classifies HTTP %s without falling back to BYOK", async (status, code, retain) => {
    const context = setup(status);
    await expect(context.analyze()).rejects.toMatchObject({ code });
    expect(context.session() !== null).toBe(retain);
    expect(context.byok.analyze).not.toHaveBeenCalled();
    expect(context.platform.analyze).not.toHaveBeenCalled();
    expect(context.clearAccountData).toHaveBeenCalledTimes(retain ? 0 : 1);
  });

  it("reports local expiry before preference sync instead of silently selecting BYOK", async () => {
    const context = setup(200, "2026-09-03T00:00:00.000Z");
    await expect(context.analyze()).rejects.toMatchObject({ code: "cloud-session-required" });
    expect(context.session()).toBeNull();
    expect(context.byok.analyze).not.toHaveBeenCalled();
  });
});
