import { describe, expect, it } from "vitest";

import {
  analysisEventSchema,
  analysisRecordSchema,
  analysisHttpRoutes,
  analysisDeleteResponseSchema,
  analysisMutationRequestSchema,
  analysisDeleteRequestSchema,
  analysisRequestStatusSchema,
  accountPreferencesRequestSchema,
  apiErrorSchema,
  claimInvitationRequestSchema,
  confirmCandidatesRequestSchema,
  confirmCandidatesResponseSchema,
  contractFixtures,
  createLearningItemRequestSchema,
  listAnalysesQuerySchema,
  listResponseSchema,
  revisionWriteHeadersSchema,
  practiceRatingsRequestSchema,
  startAnalysisRequestSchema,
  upsertWordRequestSchema,
  createExtensionPairingRequestSchema,
  claimInvitationResponseSchema,
  csrfTokenResponseSchema,
  extensionPairingResponseSchema,
  extensionSessionListResponseSchema,
  identityHttpRoutes,
  passwordRegistrationResponseSchema,
  passwordRegistrationResumeRequestSchema,
  passwordSignupCallbackFormSchema,
  passwordSignupConfirmationHttpRoutes,
  passwordSignupConfirmQuerySchema,
  passwordSignupFlowSchema,
  passwordSignupOtpSchema,
  createdInvitationResponseSchema,
  createWordbookJobRequestSchema,
  dailyQueueQuerySchema,
  quotaSummarySchema,
} from "./index.js";

describe("/v1 public contracts", () => {
  it("publishes stable analysis HTTP seams and shared fixtures", () => {
    expect(analysisHttpRoutes.start).toBe("/v1/analyses:stream");
    expect(analysisHttpRoutes.process).toBe("/v1/analyses/:id/process");
    expect(analysisHttpRoutes.confirmCandidates).toBe("/v1/analyses/:id/candidates:confirm");
    expect(analysisRequestStatusSchema.parse(contractFixtures.analysisRequestStatus)).toEqual(
      contractFixtures.analysisRequestStatus,
    );
  });
  it("publishes the fixed current-account quota route", () => {
    expect(identityHttpRoutes.quota).toBe("/v1/quota");
    expect(quotaSummarySchema.parse(contractFixtures.quota)).toEqual(contractFixtures.quota);
  });
  it("publishes strict scanner-safe password signup confirmation contracts", () => {
    const flow = "f".repeat(43);
    expect(passwordSignupConfirmationHttpRoutes).toEqual({
      callback: "/v1/auth/password/callback",
      confirm: "/v1/auth/password/confirm",
    });
    expect(passwordSignupFlowSchema.parse(flow)).toBe(flow);
    expect(passwordSignupOtpSchema.parse("123456")).toBe("123456");
    expect(passwordSignupConfirmQuerySchema.parse({ flow })).toEqual({ flow });
    expect(
      passwordSignupCallbackFormSchema.parse({
        email: "Learner@Example.COM",
        flow,
        token: "123456",
      }),
    ).toEqual({ email: "learner@example.com", flow, token: "123456" });
    expect(() => passwordSignupFlowSchema.parse("f".repeat(42))).toThrow();
    expect(() => passwordSignupOtpSchema.parse("１２３４５６")).toThrow();
    expect(() => passwordSignupConfirmQuerySchema.parse({ extra: "x", flow })).toThrow();
  });
  it("parses shared route fixtures through strict public schemas", () => {
    expect(startAnalysisRequestSchema.parse(contractFixtures.startAnalysisRequest)).toEqual(
      contractFixtures.startAnalysisRequest,
    );
    expect(analysisEventSchema.parse(contractFixtures.completedEvent)).toEqual(
      contractFixtures.completedEvent,
    );
    expect(apiErrorSchema.parse(contractFixtures.error)).toEqual(contractFixtures.error);
    expect(
      apiErrorSchema.parse({
        error: {
          code: "learning_item_archived",
          message: "Learning item is archived.",
          requestId: "request-1",
        },
      }),
    ).toBeTruthy();
    expect(
      apiErrorSchema.parse({
        error: {
          code: "learning_item_must_be_archived",
          message: "Archive the learning item before permanent deletion.",
          requestId: "request-2",
        },
      }).error.code,
    ).toBe("learning_item_must_be_archived");
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
    expect(listAnalysesQuerySchema.parse({})).toMatchObject({ archived: false, limit: 20 });
    expect(() => listAnalysesQuerySchema.parse({ cursor: "not base64!" })).toThrow();
    expect(analysisMutationRequestSchema.parse({ expectedRevision: 1 })).toEqual({
      expectedRevision: 1,
    });
    expect(
      analysisDeleteRequestSchema.parse({ deleteStudyCapture: true, expectedRevision: 1 }),
    ).toEqual({ deleteStudyCapture: true, expectedRevision: 1 });
    expect(analysisDeleteResponseSchema.parse({ deleted: true, id: "analysis-1" })).toEqual({
      deleted: true,
      id: "analysis-1",
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
      accountPreferencesRequestSchema.parse({
        dailyGoal: 5,
        expectedRevision: 1,
        timezone: "Mars/Base",
      }),
    ).toThrow();
    expect(() => dailyQueueQuerySchema.parse({ date: "2026-02-30" })).toThrow();
    expect(() =>
      quotaSummarySchema.parse({
        ...contractFixtures.quota,
        availableMicroUsd: 800_000,
      }),
    ).toThrow();
  });

  it("applies AnalysisRecord referential checks to Web deep analysis", () => {
    expect(() =>
      analysisRecordSchema.parse({
        ...contractFixtures.analysis,
        candidates: [
          {
            ...contractFixtures.analysis.candidates[0],
            analysisUnitId: "u2",
          },
        ],
      }),
    ).toThrow();
  });

  it("requires unique candidate confirmations and strict routed results", () => {
    expect(() =>
      confirmCandidatesRequestSchema.parse({
        ...contractFixtures.confirmCandidatesRequest,
        confirmations: [
          ...contractFixtures.confirmCandidatesRequest.confirmations,
          ...contractFixtures.confirmCandidatesRequest.confirmations,
        ],
      }),
    ).toThrow();
    expect(() =>
      confirmCandidatesRequestSchema.parse({
        analysisRevision: 1,
        confirmations: [
          {
            candidateId: "candidate-word",
            decision: "create",
            payload: { headword: "Works", type: "word" },
            tags: ["silently ignored"],
            targetType: "word",
          },
        ],
      }),
    ).toThrow();
    expect(
      confirmCandidatesResponseSchema.parse(contractFixtures.confirmCandidatesResponse),
    ).toEqual(contractFixtures.confirmCandidatesResponse);
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
    expect(identityHttpRoutes.claimInvitation).toBe("/v1/invitations/claim");
    expect(identityHttpRoutes.passwordLogin).toBe("/v1/auth/password/login");
    expect(identityHttpRoutes.passwordRegistrationResume).toBe("/v1/auth/password/register/resume");
    expect(
      passwordRegistrationResumeRequestSchema.parse({
        email: "Learner@Example.COM",
        invitationToken: "i".repeat(43),
        password: "correct horse battery staple",
      }),
    ).toEqual({
      email: "learner@example.com",
      invitationToken: "i".repeat(43),
      password: "correct horse battery staple",
    });
    expect(
      claimInvitationResponseSchema.parse({
        claimTicket: "c".repeat(32),
        expiresAt: "2026-08-13T01:00:00.000Z",
      }),
    ).toBeTruthy();
    expect(passwordRegistrationResponseSchema.parse({ emailConfirmationRequired: true })).toEqual({
      emailConfirmationRequired: true,
    });
    expect(
      createdInvitationResponseSchema.parse({
        consumedAt: null,
        createdAt: "2026-08-13T00:00:00.000Z",
        expiresAt: "2026-08-16T00:00:00.000Z",
        id: "invitation-1",
        invitationPath: `/join#${"i".repeat(32)}`,
        revokedAt: null,
      }).invitationPath,
    ).toBe(`/join#${"i".repeat(32)}`);
    expect(() =>
      createdInvitationResponseSchema.parse({
        consumedAt: null,
        createdAt: "2026-08-13T00:00:00.000Z",
        expiresAt: "2026-08-16T00:00:00.000Z",
        id: "invitation-1",
        invitationPath: `/join/${"i".repeat(32)}`,
        revokedAt: null,
      }),
    ).toThrow();
    expect(() =>
      passwordRegistrationResponseSchema.parse({
        claimTicket: "secret",
        emailConfirmationRequired: true,
      }),
    ).toThrow();
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
    expect(csrfTokenResponseSchema.parse({ access: "full", csrfToken: "x".repeat(32) })).toEqual({
      access: "full",
      csrfToken: "x".repeat(32),
    });
    expect(identityHttpRoutes.extensionPairing).toBe("/v1/extension-pairings/:id");
    expect(identityHttpRoutes.extensionPairingApprove).toBe("/v1/extension-pairings/:id/approve");
    expect(identityHttpRoutes.extensionSessionCurrent).toBe("/v1/extension-session");
    expect(() =>
      extensionPairingResponseSchema.parse({
        expiresAt: "2026-08-13T00:00:00.000Z",
        id: "pairing-1",
        pairingPath: "/pair-extension/pairing-1",
        status: "consumed",
      }),
    ).toThrow();
    expect(extensionSessionListResponseSchema.parse({ items: [] })).toEqual({ items: [] });
    expect(() =>
      extensionSessionListResponseSchema.parse({ items: [], sessionToken: "x" }),
    ).toThrow();
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
