import type { BrowserContext, Request, Route } from "@playwright/test";
import {
  accountResourceSchema,
  quotaSummarySchema,
  analysisHistoryResponseSchema,
  analysisRecordSchema,
  confirmCandidatesRequestSchema,
  confirmCandidatesResponseSchema,
  contractFixtures,
  createLearningItemRequestSchema,
  csrfTokenResponseSchema,
  deleteLearningItemRequestSchema,
  deleteLearningItemResponseSchema,
  extensionSessionListResponseSchema,
  idempotencyKeySchema,
  learningItemArchiveRequestSchema,
  learningItemDetailResponseSchema,
  learningItemListResponseSchema,
  listAnalysesQuerySchema,
  listLearningItemsQuerySchema,
  processAnalysisRequestSchema,
  type AnalysisRecord,
  type ApiError,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";

import { serveCloudWebDist } from "./cloud-browser-web-fixture.js";
import { createCloudBrowserAnalysisHistoryAuthority } from "./cloud-browser-authority-analysis-history.js";
import { createCloudBrowserAdminOperationsAuthority } from "./cloud-browser-authority-admin-operations.js";
import { createCloudBrowserDataRightsAuthority } from "./cloud-browser-authority-data-rights.js";
import { createCloudBrowserDuplicateSuggestionAuthority } from "./cloud-browser-authority-duplicate-suggestions.js";
import {
  createCloudBrowserGoogleAuthenticationAuthority,
  type GoogleAuthenticationSeed,
} from "./cloud-browser-authority-google-authentication.js";
import {
  createCloudBrowserLearningItem,
  createCloudBrowserManualLearningItem,
} from "./cloud-browser-authority-learning.js";
import { createCloudBrowserOnboardingAuthority } from "./cloud-browser-authority-onboarding.js";
import { createCloudBrowserPairingApprovalAuthority } from "./cloud-browser-authority-pairing-approval.js";
import { createCloudBrowserPasswordAuthenticationAuthority } from "./cloud-browser-authority-password-authentication.js";
import { createCloudBrowserPasswordRecoveryAuthority } from "./cloud-browser-authority-password-recovery.js";
import { createCloudBrowserPracticeAuthority } from "./cloud-browser-authority-practice.js";
import { createCloudBrowserPracticeHistoryAuthority } from "./cloud-browser-authority-practice-history.js";
import {
  cloudCors,
  cloudErrorBody,
  cloudQueryObject,
  cloudRequestBody,
  type CloudStoredReplay,
} from "./cloud-browser-authority-request.js";
import type {
  CloudBrowserAuthenticatedAs,
  CloudBrowserAuthority,
  CloudBrowserAuthoritySeed,
  CloudBrowserRequestFact,
} from "./cloud-browser-authority-types.js";
import { createCloudBrowserStreamingAuthority } from "./cloud-browser-authority-streaming.js";
import { createCloudBrowserExtensionQueryAuthority } from "./cloud-browser-authority-extension-query.js";
import { createCloudBrowserStudyCaptureAuthority } from "./cloud-browser-authority-study-captures.js";
import { createCloudBrowserSignInMethodsAuthority } from "./cloud-browser-authority-sign-in-methods.js";
import { createCloudBrowserWordAuthority } from "./cloud-browser-authority-words.js";
import { createCloudBrowserWordbookAuthority } from "./cloud-browser-authority-wordbooks.js";

const apiOrigin = "https://api.huayi.invalid";
const webOrigin = "https://web.huayi.invalid";
const csrfToken = "cloud-e2e-csrf-token-000000000000";
const extensionToken = "cloud-e2e-extension-session-token-000000000000";
const secondaryExtensionToken = "cloud-e2e-secondary-session-token-00000000000";

function isGoogleAuthenticationSeed(
  seed: CloudBrowserAuthoritySeed["seed"],
): seed is GoogleAuthenticationSeed {
  return (
    seed === "disabled-google-authentication" ||
    seed === "google-authentication" ||
    seed === "unregistered-google-authentication"
  );
}
const now = "2026-08-13T10:00:00.000Z";

export function createCloudBrowserAuthority(
  seed: CloudBrowserAuthoritySeed,
): CloudBrowserAuthority {
  const installedContexts = new WeakSet<BrowserContext>();
  let analyses: AnalysisRecord[] =
    seed.seed === "candidate-analysis"
      ? [analysisRecordSchema.parse(contractFixtures.analysis)]
      : [];
  const duplicateSuggestions = createCloudBrowserDuplicateSuggestionAuthority(
    seed.seed === "semantic-duplicate-suggestions",
    now,
  );
  let items: LearningItemDetailResponse[] = duplicateSuggestions.seedItems();
  const importCount = 0;
  const facts: CloudBrowserRequestFact[] = [];
  const replays = new Map<string, CloudStoredReplay>();
  const hasEmptyPracticeQueue =
    seed.seed === "google-authentication" ||
    seed.seed === "invitation-onboarding" ||
    seed.seed === "password-authentication" ||
    seed.seed === "password-recovery";
  const practice =
    seed.seed === "dialogue-practice" || seed.seed === "pending-sentence-practice"
      ? createCloudBrowserPracticeAuthority(seed.seed)
      : hasEmptyPracticeQueue
        ? createCloudBrowserPracticeAuthority("empty-practice")
        : null;
  const analysisHistory =
    seed.seed === "analysis-history-maintenance"
      ? createCloudBrowserAnalysisHistoryAuthority()
      : null;
  const practiceHistory =
    seed.seed === "completed-practice-history"
      ? createCloudBrowserPracticeHistoryAuthority()
      : null;
  const onboarding =
    seed.seed === "invitation-onboarding" ? createCloudBrowserOnboardingAuthority() : null;
  const passwordAuthentication =
    seed.seed === "password-authentication" || seed.seed === "unregistered-password-login"
      ? createCloudBrowserPasswordAuthenticationAuthority(seed.seed)
      : null;
  const passwordRecovery =
    seed.seed === "password-recovery" ? createCloudBrowserPasswordRecoveryAuthority() : null;
  const googleAuthentication = isGoogleAuthenticationSeed(seed.seed)
    ? createCloudBrowserGoogleAuthenticationAuthority(seed.seed)
    : null;
  const pairingApproval =
    seed.seed === "pending-pairing-approval" ? createCloudBrowserPairingApprovalAuthority() : null;
  const streaming = createCloudBrowserStreamingAuthority();
  const adminOperations = createCloudBrowserAdminOperationsAuthority(
    seed.seed === "operator-console",
  );
  const dataRights = createCloudBrowserDataRightsAuthority();
  const extensionQueries = createCloudBrowserExtensionQueryAuthority({
    quotaExhausted: seed.seed === "platform-query-quota",
  });
  const studyCaptures = createCloudBrowserStudyCaptureAuthority();
  const signInMethods = createCloudBrowserSignInMethodsAuthority(
    seed.seed === "password-only-sign-in-methods" ||
      seed.seed === "google-only-sign-in-methods" ||
      seed.seed === "stale-password-sign-in-methods"
      ? seed.seed
      : null,
  );
  const words = createCloudBrowserWordAuthority();
  const wordbooks = createCloudBrowserWordbookAuthority(words);
  let primaryExtensionSessionRevoked = false;

  const json = async (route: Route, status: number, body: unknown) => {
    const headers = cloudCors(route.request().headers().origin) ?? {};
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json; charset=utf-8",
      headers,
      status,
    });
  };

  const authentication = (request: Request): CloudBrowserAuthenticatedAs => {
    const headers = request.headers();
    if (googleAuthentication?.authenticated(request) === true) return "web";
    if (
      (headers.authorization === `HuayiExtension ${extensionToken}` &&
        !primaryExtensionSessionRevoked) ||
      headers.authorization === `HuayiExtension ${secondaryExtensionToken}`
    ) {
      return "extension";
    }
    return /(?:^|;\s*)huayi_session=cloud-e2e-(?:linked-web-session|password-(?:login|recovery-login|registration)-session|web-session)(?:;|$)/u.test(
      headers.cookie ?? "",
    )
      ? "web"
      : "none";
  };

  const record = (request: Request, proof: CloudBrowserRequestFact["proof"]) => {
    const url = new URL(request.url());
    facts.push({
      authenticatedAs: authentication(request),
      method: request.method(),
      path: url.pathname,
      proof,
    });
  };

  const webMutationProof = (request: Request, revision?: number): boolean => {
    const headers = request.headers();
    if (
      authentication(request) !== "web" ||
      headers.origin !== webOrigin ||
      ![csrfToken, signInMethods.csrfToken()].includes(headers["x-csrf-token"] ?? "") ||
      (revision === undefined
        ? headers["if-match"] !== undefined
        : headers["if-match"] !== `"${revision}"`)
    ) {
      return false;
    }
    return true;
  };

  const webProof = (request: Request, revision?: number): string | null => {
    const headers = request.headers();
    if (!webMutationProof(request, revision)) return null;
    return idempotencyKeySchema.safeParse(headers["idempotency-key"]).success
      ? (headers["idempotency-key"] ?? null)
      : null;
  };

  const replay = (path: string, key: string, hash: string): unknown | "conflict" | undefined => {
    const existing = replays.get(`${path}\u0000${key}`);
    if (existing === undefined) return undefined;
    return existing.hash === hash ? structuredClone(existing.response) : "conflict";
  };

  const saveReplay = (path: string, key: string, hash: string, response: unknown) => {
    replays.set(`${path}\u0000${key}`, { hash, response: structuredClone(response) });
  };

  const reject = async (
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof: CloudBrowserRequestFact["proof"] = "write-invalid",
  ) => {
    record(route.request(), proof);
    await json(route, status, cloudErrorBody(code));
  };

  const handleAnalysisMutation = async (
    route: Route,
    id: string,
    operation: "confirm" | "process",
  ) => {
    const request = route.request();
    const analysis = analyses.find((candidate) => candidate.id === id);
    if (analysis === undefined) return reject(route, 404, "not_found");
    const body = cloudRequestBody(request);
    const parsed =
      operation === "confirm"
        ? confirmCandidatesRequestSchema.safeParse(body)
        : processAnalysisRequestSchema.safeParse(body);
    if (!parsed.success) return reject(route, 400, "invalid_request");
    const revision =
      "analysisRevision" in parsed.data
        ? parsed.data.analysisRevision
        : parsed.data.expectedRevision;
    const key = webProof(request, revision);
    if (key === null) return reject(route, 403, "forbidden");
    const path = new URL(request.url()).pathname;
    const hash = JSON.stringify(parsed.data);
    const prior = replay(path, key, hash);
    if (prior === "conflict") return reject(route, 409, "idempotency_conflict", "write-valid");
    if (prior !== undefined) {
      record(request, "write-valid");
      await json(route, 200, prior);
      return;
    }
    if (analysis.revision !== revision) {
      return reject(route, 409, "revision_conflict", "write-valid");
    }
    let confirmedItem: LearningItemDetailResponse | null = null;
    if (operation === "confirm") {
      try {
        confirmedItem = createCloudBrowserLearningItem(analysis, parsed.data, now);
      } catch {
        return reject(route, 400, "invalid_request", "write-valid");
      }
    }
    const updated = analysisRecordSchema.parse({
      ...analysis,
      reviewState: "reviewed",
      revision: analysis.revision + 1,
      updatedAt: now,
    });
    analyses = analyses.map((candidate) => (candidate.id === id ? updated : candidate));
    const response =
      operation === "confirm"
        ? confirmCandidatesResponseSchema.parse({
            analysis: updated,
            results: [
              {
                action: "created",
                candidateId: analysis.candidates[0]?.id,
                item: confirmedItem?.item,
                type: "learning-item",
              },
            ],
          })
        : updated;
    if (confirmedItem !== null) items = [...items, confirmedItem];
    saveReplay(path, key, hash, response);
    record(request, "write-valid");
    await json(route, 200, response);
  };

  const handleLearningCreate = async (route: Route) => {
    const request = route.request();
    const parsed = createLearningItemRequestSchema.safeParse(cloudRequestBody(request));
    if (!parsed.success) return reject(route, 400, "invalid_request");
    const key = webProof(request);
    if (key === null) return reject(route, 403, "forbidden");
    const path = new URL(request.url()).pathname;
    const hash = JSON.stringify(parsed.data);
    const prior = replay(path, key, hash);
    if (prior === "conflict") return reject(route, 409, "idempotency_conflict", "write-valid");
    if (prior !== undefined) {
      record(request, "write-valid");
      await json(route, 200, prior);
      return;
    }
    const created = createCloudBrowserManualLearningItem(
      parsed.data,
      now,
      `item-${items.length + 1}`,
    );
    if (items.some((item) => item.item.canonicalKey === created.item.canonicalKey)) {
      return reject(route, 409, "exact_duplicate", "write-valid");
    }
    items = [...items, created];
    saveReplay(path, key, hash, created);
    record(request, "write-valid");
    await json(route, 201, created);
  };

  const handleLearningArchive = async (
    route: Route,
    id: string,
    operation: "archive" | "restore",
  ) => {
    const request = route.request();
    const item = items.find((candidate) => candidate.item.id === id);
    if (item === undefined) return reject(route, 404, "not_found");
    const parsed = learningItemArchiveRequestSchema.safeParse(cloudRequestBody(request));
    if (!parsed.success) return reject(route, 400, "invalid_request");
    const key = webProof(request, parsed.data.expectedRevision);
    if (key === null) return reject(route, 403, "forbidden");
    const path = new URL(request.url()).pathname;
    const hash = JSON.stringify(parsed.data);
    const prior = replay(path, key, hash);
    if (prior === "conflict") return reject(route, 409, "idempotency_conflict", "write-valid");
    if (prior !== undefined) {
      record(request, "write-valid");
      await json(route, 200, prior);
      return;
    }
    if (item.item.revision !== parsed.data.expectedRevision) {
      return reject(route, 409, "revision_conflict", "write-valid");
    }
    if ((item.archivedAt !== null) !== (operation === "restore")) {
      return reject(route, 400, "invalid_request", "write-valid");
    }
    const updated = learningItemDetailResponseSchema.parse({
      ...item,
      archivedAt: operation === "archive" ? now : null,
      item: {
        ...item.item,
        revision: item.item.revision + 1,
        updatedAt: now,
      },
    });
    items = items.map((candidate) => (candidate.item.id === id ? updated : candidate));
    saveReplay(path, key, hash, updated);
    record(request, "write-valid");
    await json(route, 200, updated);
  };

  const handleLearningDelete = async (route: Route, id: string) => {
    const request = route.request();
    const item = items.find((candidate) => candidate.item.id === id);
    if (item === undefined) return reject(route, 404, "not_found");
    const parsed = deleteLearningItemRequestSchema.safeParse(cloudRequestBody(request));
    if (!parsed.success) return reject(route, 400, "invalid_request");
    const key = webProof(request, parsed.data.expectedRevision);
    if (key === null) return reject(route, 403, "forbidden");
    const path = new URL(request.url()).pathname;
    const hash = JSON.stringify(parsed.data);
    const prior = replay(path, key, hash);
    if (prior === "conflict") return reject(route, 409, "idempotency_conflict", "write-valid");
    if (prior !== undefined) {
      record(request, "write-valid");
      await json(route, 200, prior);
      return;
    }
    if (item.item.revision !== parsed.data.expectedRevision) {
      return reject(route, 409, "revision_conflict", "write-valid");
    }
    if (item.recentPractice !== null && item.archivedAt === null) {
      return reject(route, 409, "learning_item_must_be_archived", "write-valid");
    }
    const response = deleteLearningItemResponseSchema.parse({
      deleted: true,
      deletionKind: item.recentPractice === null ? "hard-delete" : "erased",
      id,
    });
    items = items.filter((candidate) => candidate.item.id !== id);
    saveReplay(path, key, hash, response);
    record(request, "write-valid");
    await json(route, 200, response);
  };

  const handleApi = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = cloudCors(request.headers().origin);
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: headers ?? {}, status: headers === null ? 403 : 204 });
      return;
    }
    if (onboarding !== null && (await onboarding.handleApi(route, { json, record, reject }))) {
      return;
    }
    if (
      passwordAuthentication !== null &&
      (await passwordAuthentication.handleApi(route, { json, record, reject }))
    ) {
      return;
    }
    if (passwordRecovery !== null && (await passwordRecovery.handleApi(route, { record }))) return;
    if (
      googleAuthentication !== null &&
      (await googleAuthentication.handleApi(route, { record }))
    ) {
      return;
    }
    if (url.pathname === "/v1/auth/csrf" && request.method() === "GET") {
      record(request, "read");
      await json(
        route,
        authentication(request) === "web" ? 200 : 401,
        authentication(request) === "web"
          ? csrfTokenResponseSchema.parse({
              access: "full",
              csrfToken: request.headers().cookie?.includes("linked-web-session")
                ? signInMethods.csrfToken()
                : csrfToken,
            })
          : cloudErrorBody("authentication_required"),
      );
      return;
    }
    if (url.pathname === "/v1/extension-session" && request.method() === "DELETE") {
      record(request, "write-valid");
      if (request.headers().authorization === `HuayiExtension ${extensionToken}`) {
        primaryExtensionSessionRevoked = true;
      }
      await route.fulfill({ status: 204 });
      return;
    }
    if (
      await adminOperations.handle(route, {
        authentication,
        json,
        record,
        reject,
        writeProof: webProof,
      })
    ) {
      return;
    }
    if (
      await dataRights.handle(route, {
        authentication,
        json,
        mutationProof: webMutationProof,
        record,
        reject,
        writeProof: webProof,
      })
    ) {
      return;
    }
    if (await extensionQueries.handle(route, { authentication, record, reject })) return;
    if (
      await words.handle(route, {
        authentication,
        json,
        mutationProof: webMutationProof,
        record,
        reject,
        writeProof: webProof,
      })
    ) {
      return;
    }
    if (
      await wordbooks.handle(route, {
        authentication,
        json,
        record,
        reject,
        writeProof: webProof,
      })
    ) {
      return;
    }
    if (
      await studyCaptures.handle(route, {
        authentication,
        json,
        onCompleted: (analysis) => (analyses = [...analyses, analysis]),
        record,
        reject,
        writeProof: webProof,
      })
    ) {
      return;
    }
    if (authentication(request) !== "web") {
      await reject(route, 401, "authentication_required", "read");
      return;
    }
    if (
      await signInMethods.handleApi(route, {
        json,
        mutationProof: webMutationProof,
        record,
        reject,
      })
    ) {
      return;
    }
    if (
      pairingApproval !== null &&
      (await pairingApproval.handle(route, {
        json,
        mutationProof: webMutationProof,
        record,
        reject,
      }))
    ) {
      return;
    }
    if (url.pathname === "/v1/extension-sessions" && request.method() === "GET") {
      record(request, "read");
      await json(
        route,
        200,
        extensionSessionListResponseSchema.parse({
          items: primaryExtensionSessionRevoked
            ? []
            : [
                {
                  createdAt: now,
                  deviceLabel: "Chrome on Mac",
                  expiresAt: "2026-09-13T10:00:00.000Z",
                  id: "extension-session-1",
                  lastUsedAt: now,
                },
              ],
        }),
      );
      return;
    }
    if (url.pathname === "/v1/account" && request.method() === "GET") {
      record(request, "read");
      await json(
        route,
        200,
        accountResourceSchema.parse({
          email: "learner@example.com",
          extensionSessions: primaryExtensionSessionRevoked
            ? []
            : [
                {
                  createdAt: now,
                  deviceLabel: "Chrome on Mac",
                  expiresAt: "2026-09-13T10:00:00.000Z",
                  id: "extension-session-1",
                  lastUsedAt: now,
                },
              ],
          minSupportedExtensionVersion: "1.0.0",
          preferences: {
            cloudWordCopyMode: "enabled",
            dailyGoal: 2,
            extensionQueryModelMode: "platform",
            revision: 1,
            studyCaptureMode: "manual",
            timezone: "Asia/Shanghai",
            updatedAt: now,
          },
        }),
      );
      return;
    }
    if (
      (seed.seed === "password-only-sign-in-methods" ||
        seed.seed === "google-only-sign-in-methods" ||
        seed.seed === "stale-password-sign-in-methods") &&
      url.pathname === "/v1/quota" &&
      request.method() === "GET"
    ) {
      record(request, "read");
      await json(route, 200, quotaSummarySchema.parse(contractFixtures.quota));
      return;
    }
    if (
      await streaming.handle(route, {
        onCompleted: (analysis) => (analyses = [...analyses, analysis]),
        record,
        reject,
        writeProof: webProof,
      })
    )
      return;
    if (
      practice !== null &&
      (await practice.handle(route, { json, record, reject, writeProof: webProof }))
    ) {
      return;
    }
    if (
      practiceHistory !== null &&
      (await practiceHistory.handle(route, { json, record, reject, writeProof: webProof }))
    ) {
      return;
    }
    if (
      analysisHistory !== null &&
      (await analysisHistory.handle(route, { json, record, reject, writeProof: webProof }))
    ) {
      return;
    }
    if (url.pathname === "/v1/analyses" && request.method() === "GET") {
      const query = listAnalysesQuerySchema.safeParse(cloudQueryObject(url));
      if (!query.success) return reject(route, 400, "invalid_request", "read");
      const visible = analyses.filter(
        (analysis) =>
          analysis.archivedAt === null &&
          (query.data.reviewState === undefined || analysis.reviewState === query.data.reviewState),
      );
      record(request, "read");
      await json(
        route,
        200,
        analysisHistoryResponseSchema.parse({ items: visible, nextCursor: null }),
      );
      return;
    }
    const confirm = /^\/v1\/analyses\/([^/]+)\/candidates:confirm$/u.exec(url.pathname);
    if (confirm?.[1] !== undefined && request.method() === "POST") {
      await handleAnalysisMutation(route, decodeURIComponent(confirm[1]), "confirm");
      return;
    }
    const process = /^\/v1\/analyses\/([^/]+)\/process$/u.exec(url.pathname);
    if (process?.[1] !== undefined && request.method() === "POST") {
      await handleAnalysisMutation(route, decodeURIComponent(process[1]), "process");
      return;
    }
    const analysisDetail = /^\/v1\/analyses\/([^/]+)$/u.exec(url.pathname);
    if (analysisDetail?.[1] !== undefined && request.method() === "GET") {
      const analysis = analyses.find((candidate) => candidate.id === analysisDetail[1]);
      record(request, "read");
      await json(
        route,
        analysis === undefined ? 404 : 200,
        analysis ?? cloudErrorBody("not_found"),
      );
      return;
    }
    if (url.pathname === "/v1/learning-items" && request.method() === "GET") {
      const query = listLearningItemsQuerySchema.safeParse(cloudQueryObject(url));
      if (!query.success) {
        return reject(route, 400, "invalid_request", "read");
      }
      const visible = items.filter((item) => (item.archivedAt !== null) === query.data.archived);
      record(request, "read");
      await json(
        route,
        200,
        learningItemListResponseSchema.parse({ items: visible, nextCursor: null }),
      );
      return;
    }
    if (url.pathname === "/v1/learning-items" && request.method() === "POST") {
      await handleLearningCreate(route);
      return;
    }
    if (
      await duplicateSuggestions.handle(route, {
        items: () => items,
        json,
        record,
        reject,
        replaceItems: (updated) => (items = updated),
        replay,
        saveReplay,
        webMutationProof,
        webProof,
      })
    ) {
      return;
    }
    const itemArchive = /^\/v1\/learning-items\/([^/]+)\/(archive|restore)$/u.exec(url.pathname);
    if (
      itemArchive?.[1] !== undefined &&
      itemArchive[2] !== undefined &&
      request.method() === "POST"
    ) {
      await handleLearningArchive(
        route,
        decodeURIComponent(itemArchive[1]),
        itemArchive[2] as "archive" | "restore",
      );
      return;
    }
    const itemDetail = /^\/v1\/learning-items\/([^/]+)$/u.exec(url.pathname);
    if (itemDetail?.[1] !== undefined && request.method() === "DELETE") {
      await handleLearningDelete(route, decodeURIComponent(itemDetail[1]));
      return;
    }
    if (itemDetail?.[1] !== undefined && request.method() === "GET") {
      const item = items.find((candidate) => candidate.item.id === itemDetail[1]);
      record(request, "read");
      await json(route, item === undefined ? 404 : 200, item ?? cloudErrorBody("not_found"));
      return;
    }
    await reject(route, 404, "not_found", request.method() === "GET" ? "read" : "write-invalid");
  };

  return {
    async install(page) {
      const context = page.context();
      if (seed.authenticated) {
        await context.addCookies([
          {
            httpOnly: true,
            name: "huayi_session",
            sameSite: "Lax",
            secure: true,
            url: apiOrigin,
            value: "cloud-e2e-web-session",
          },
        ]);
      }
      if (!installedContexts.has(context)) {
        await context.route(`${webOrigin}/**`, serveCloudWebDist);
        await context.route(`${apiOrigin}/**`, handleApi);
        installedContexts.add(context);
      }
      await onboarding?.install(page);
      await passwordAuthentication?.install(page);
      await passwordRecovery?.install(page);
      await googleAuthentication?.install(page);
      await signInMethods.install(page);
    },
    markLearningItemPracticed(id) {
      items = items.map((item) =>
        item.item.id === id
          ? learningItemDetailResponseSchema.parse({
              ...item,
              hasPracticeHistory: true,
              recentPractice: {
                completedAt: now,
                rating: "mastered",
                sessionId: "session-erasure-1",
                type: "sentence-creation",
              },
            })
          : item,
      );
    },
    snapshot: () => ({
      analysisCount: analyses.length + (analysisHistory?.analysisCount() ?? 0),
      captureCount: studyCaptures.count() + (analysisHistory?.captureCount() ?? 0),
      duplicateSuggestionProviderCallCount: duplicateSuggestions.providerCallCount(),
      extensionQueryCount: extensionQueries.count(),
      extensionSessionCount:
        passwordRecovery?.snapshot().extensionSessionCount ??
        (pairingApproval !== null ||
        passwordAuthentication !== null ||
        primaryExtensionSessionRevoked
          ? 0
          : 1),
      importCount,
      itemCount: items.length,
      practiceProviderCallCount: practice?.providerCalls() ?? 0,
      practiceHistoryCount: practiceHistory?.count() ?? 0,
      requestFacts: structuredClone(facts),
      securityNotificationCount: passwordRecovery?.snapshot().notificationCount ?? 0,
      webSessionCount:
        googleAuthentication?.snapshot().webSessionCount ??
        passwordRecovery?.snapshot().webSessionCount ??
        (seed.authenticated ? 1 : 0),
      wordCopyCount: words.copyCount(),
      wordCount: words.count(),
      wordImportCount: words.importCount(),
      wordbookJobCount: wordbooks.count(),
    }),
  };
}
