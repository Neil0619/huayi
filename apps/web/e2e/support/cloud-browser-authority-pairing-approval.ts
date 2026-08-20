import type { Request, Route } from "@playwright/test";
import {
  accountPreferencesResponseSchema,
  approveExtensionPairingRequestSchema,
  extensionPairingResponseSchema,
  type AccountPreferences,
  type ApiError,
} from "@huayi/cloud-contracts";

import { cloudCors, cloudRequestBody } from "./cloud-browser-authority-request.js";

interface Hooks {
  json(route: Route, status: number, body: unknown): Promise<void>;
  mutationProof(request: Request): boolean;
  record(request: Request, proof: "read" | "write-valid"): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: "read" | "write-invalid" | "write-valid",
  ): Promise<void>;
}

const pairingId = "pairing-approval-1";
const pairingPath = `/v1/extension-pairings/${pairingId}`;
const now = "2026-08-13T10:00:00.000Z";

function initialPreferences(): AccountPreferences {
  return accountPreferencesResponseSchema.parse({
    cloudWordCopyMode: "enabled",
    dailyGoal: 2,
    extensionQueryModelMode: "platform",
    revision: 3,
    studyCaptureMode: "manual",
    timezone: "Asia/Shanghai",
    updatedAt: now,
  });
}

export function createCloudBrowserPairingApprovalAuthority() {
  let pairingStatus: "approved" | "pending" = "pending";
  let preferences = initialPreferences();

  const handle = async (route: Route, hooks: Hooks): Promise<boolean> => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === pairingPath && request.method() === "GET") {
      hooks.record(request, "read");
      await hooks.json(
        route,
        200,
        extensionPairingResponseSchema.parse({
          expiresAt: "2026-08-13T10:10:00.000Z",
          id: pairingId,
          pairingPath: `/pair-extension/${pairingId}`,
          status: pairingStatus,
        }),
      );
      return true;
    }
    if (path === "/v1/account/preferences" && request.method() === "GET") {
      hooks.record(request, "read");
      await hooks.json(route, 200, accountPreferencesResponseSchema.parse(preferences));
      return true;
    }
    if (path === `${pairingPath}/approve` && request.method() === "POST") {
      const headers = request.headers();
      const parsed = approveExtensionPairingRequestSchema.safeParse(cloudRequestBody(request));
      if (!parsed.success) {
        await hooks.reject(route, 400, "invalid_request");
        return true;
      }
      if (
        !hooks.mutationProof(request) ||
        headers["idempotency-key"] !== undefined ||
        headers["if-match"] !== undefined
      ) {
        await hooks.reject(route, 403, "forbidden");
        return true;
      }
      if (pairingStatus !== "pending") {
        await hooks.reject(route, 404, "not_found", "write-valid");
        return true;
      }
      if (parsed.data.expectedPreferencesRevision !== preferences.revision) {
        await hooks.reject(route, 409, "revision_conflict", "write-valid");
        return true;
      }
      const changed =
        parsed.data.cloudWordCopyMode !== preferences.cloudWordCopyMode ||
        parsed.data.extensionQueryModelMode !== preferences.extensionQueryModelMode ||
        parsed.data.studyCaptureMode !== preferences.studyCaptureMode;
      preferences = accountPreferencesResponseSchema.parse({
        ...preferences,
        cloudWordCopyMode: parsed.data.cloudWordCopyMode,
        extensionQueryModelMode: parsed.data.extensionQueryModelMode,
        revision: preferences.revision + (changed ? 1 : 0),
        studyCaptureMode: parsed.data.studyCaptureMode,
        updatedAt: changed ? "2026-08-13T10:01:00.000Z" : preferences.updatedAt,
      });
      pairingStatus = "approved";
      hooks.record(request, "write-valid");
      await route.fulfill({ headers: cloudCors(request.headers().origin) ?? {}, status: 204 });
      return true;
    }
    return false;
  };

  return { handle };
}
