import { describe, expect, it } from "vitest";

import {
  analysisEventSchema,
  accountPreferencesRequestSchema,
  apiErrorSchema,
  claimInvitationRequestSchema,
  confirmCandidatesRequestSchema,
  contractFixtures,
  createLearningItemRequestSchema,
  importAnalysisRequestSchema,
  listAnalysesQuerySchema,
  listResponseSchema,
  revisionWriteHeadersSchema,
  practiceRatingsRequestSchema,
  startAnalysisRequestSchema,
  upsertWordRequestSchema,
  createExtensionPairingRequestSchema,
  createWordbookJobRequestSchema,
  dailyQueueQuerySchema,
  quotaSummarySchema,
} from "./index.js";

describe("/v1 public contracts", () => {
  it("parses shared route fixtures through strict public schemas", () => {
    expect(startAnalysisRequestSchema.parse(contractFixtures.startAnalysisRequest)).toEqual(
      contractFixtures.startAnalysisRequest,
    );
    expect(importAnalysisRequestSchema.parse(contractFixtures.importAnalysisRequest)).toEqual(
      contractFixtures.importAnalysisRequest,
    );
    expect(analysisEventSchema.parse(contractFixtures.completedEvent)).toEqual(
      contractFixtures.completedEvent,
    );
    expect(apiErrorSchema.parse(contractFixtures.error)).toEqual(contractFixtures.error);
  });

  it("enforces source, pagination, SSE, error, and bounded input rules", () => {
    expect(() =>
      startAnalysisRequestSchema.parse({
        ...contractFixtures.startAnalysisRequest,
        sourceText: "x".repeat(2_001),
      }),
    ).toThrow();
    expect(() => listAnalysesQuerySchema.parse({ limit: 101 })).toThrow();
    expect(listAnalysesQuerySchema.parse({ archived: "false", limit: "20" })).toMatchObject({
      archived: false,
      limit: 20,
    });
    expect(() =>
      analysisEventSchema.parse({
        requestId: "request-1",
        section: "sentence:1",
        text: "x".repeat(4_097),
        type: "analysis.preview",
      }),
    ).toThrow();
    expect(() =>
      apiErrorSchema.parse({
        error: { code: "provider_secret", message: "bad", requestId: "request-1" },
      }),
    ).toThrow();
    expect(() => listResponseSchema.parse({ items: [], nextCursor: "", total: 0 })).toThrow();
    expect(() =>
      accountPreferencesRequestSchema.parse({ dailyGoal: 5, timezone: "Mars/Base" }),
    ).toThrow();
    expect(() => dailyQueueQuerySchema.parse({ date: "2026-02-30" })).toThrow();
    expect(() =>
      quotaSummarySchema.parse({
        ...contractFixtures.quota,
        availableMicroUsd: 800_000,
      }),
    ).toThrow();
  });

  it("applies AnalysisRecord referential checks to BYOK imports", () => {
    expect(() =>
      importAnalysisRequestSchema.parse({
        ...contractFixtures.importAnalysisRequest,
        candidates: [
          {
            ...contractFixtures.importAnalysisRequest.candidates[0],
            sentenceId: "s2",
          },
        ],
      }),
    ).toThrow();
  });
});

describe("client authority and secret rejection", () => {
  const forbiddenValues: readonly (readonly [string, unknown])[] = [
    ["ownerUserId", "user-1"],
    ["userId", "user-1"],
    ["role", "admin"],
    ["apiKey", "secret"],
    ["authorization", "Bearer secret"],
    ["baseUrl", "https://evil.example"],
    ["headers", { X: "secret" }],
    ["reasoning", "hidden"],
    ["reasoningContent", "hidden"],
    ["url", "https://example.com/page"],
  ];

  it.each(forbiddenValues)("rejects forbidden analysis field %s", (field, value) => {
    expect(() =>
      startAnalysisRequestSchema.parse({
        ...contractFixtures.startAnalysisRequest,
        [field]: value,
      }),
    ).toThrow();
    expect(() =>
      importAnalysisRequestSchema.parse({
        ...contractFixtures.importAnalysisRequest,
        [field]: value,
      }),
    ).toThrow();
  });

  it("rejects authority fields across learning, word, and practice writes", () => {
    const checks = [
      () =>
        confirmCandidatesRequestSchema.parse({
          ...contractFixtures.confirmCandidatesRequest,
          userId: "user-1",
        }),
      () =>
        createLearningItemRequestSchema.parse({
          ...contractFixtures.createLearningItemRequest,
          role: "admin",
        }),
      () =>
        upsertWordRequestSchema.parse({
          ...contractFixtures.upsertWordRequest,
          authorization: "secret",
        }),
      () =>
        practiceRatingsRequestSchema.parse({
          ...contractFixtures.practiceRatingsRequest,
          ownerUserId: "user-1",
        }),
    ];
    for (const check of checks) expect(check).toThrow();
  });

  it("keeps account, pairing, wordbook, and concurrency envelopes strict", () => {
    expect(claimInvitationRequestSchema.parse({ invitationToken: "x".repeat(32) })).toBeTruthy();
    expect(() =>
      claimInvitationRequestSchema.parse({ invitationToken: "x".repeat(32), userId: "user-1" }),
    ).toThrow();
    expect(
      createExtensionPairingRequestSchema.parse({
        installIdHash: "a".repeat(32),
        pkceChallenge: "b".repeat(43),
        state: "c".repeat(32),
      }),
    ).toBeTruthy();
    expect(() =>
      createWordbookJobRequestSchema.parse({ direction: "import", target: "shanbay" }),
    ).toThrow();
    expect(
      revisionWriteHeadersSchema.parse({
        "idempotency-key": "write-1",
        "if-match": '"3"',
      }),
    ).toBeTruthy();
    expect(() =>
      revisionWriteHeadersSchema.parse({ "idempotency-key": "write-1", "if-match": "3" }),
    ).toThrow();
  });
});
