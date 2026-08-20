import { studyCaptureCreateRequestSchema } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createCloudStudyCaptureApi,
  type CloudStudyCaptureError,
} from "./cloud-study-capture-api.js";

const now = "2026-08-13T00:00:00.000Z";
const response = {
  capture: {
    captureCount: 1,
    createdAt: now,
    firstCapturedAt: now,
    id: "capture-1",
    kind: "sentence",
    lastCapturedAt: now,
    normalizedTextHash: "a".repeat(64),
    revision: 1,
    sourceText: "This is worth learning.",
    status: "pending",
    updatedAt: now,
  },
  outcome: "created",
  undo: { captureId: "capture-1", expectedRevision: 1 },
} as const;

describe("SW StudyCapture adapter", () => {
  it("submits only original learning intent to the fixed route", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const api = createCloudStudyCaptureApi({
      apiOrigin: "https://api.huayi.invalid",
      clientVersion: "1.0.0",
      fetch,
    });
    const input = studyCaptureCreateRequestSchema.parse({
      kind: "sentence",
      sourceText: "This is worth learning.",
    });

    await expect(api.submit(input, "submission-1", "t".repeat(32))).resolves.toEqual(response);
    expect(fetch.mock.calls[0]?.[0]).toEqual(
      new URL("/v1/study-captures", "https://api.huayi.invalid"),
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", method: "POST" });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(input);
    expect(String(fetch.mock.calls[0]?.[1]?.body)).not.toContain("translationZh");
  });

  it.each([
    [401, "authentication"],
    [429, "transient"],
    [503, "transient"],
    [400, "permanent"],
    [426, "client-upgrade-required"],
  ] as const)("classifies status %s as %s without response content", async (status, kind) => {
    const api = createCloudStudyCaptureApi({
      apiOrigin: "https://api.huayi.invalid",
      clientVersion: "1.0.0",
      fetch: async () => new Response("secret response", { status }),
    });

    await expect(
      api.submit(
        { kind: "sentence", sourceText: "This is worth learning." },
        "submission-1",
        "t".repeat(32),
      ),
    ).rejects.toMatchObject({ kind } satisfies Partial<CloudStudyCaptureError>);
  });

  it("fails closed on invalid origin before fetch", () => {
    const fetch = vi.fn();
    expect(() =>
      createCloudStudyCaptureApi({
        apiOrigin: "http://api.huayi.invalid",
        clientVersion: "1.0.0",
        fetch,
      }),
    ).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats an invalid success response as retryable", async () => {
    const api = createCloudStudyCaptureApi({
      apiOrigin: "https://api.huayi.invalid",
      clientVersion: "1.0.0",
      fetch: async () => Response.json({ unexpected: "body" }),
    });

    await expect(
      api.submit(
        { kind: "sentence", sourceText: "This is worth learning." },
        "submission-1",
        "t".repeat(32),
      ),
    ).rejects.toMatchObject({ kind: "transient" } satisfies Partial<CloudStudyCaptureError>);
  });
});
