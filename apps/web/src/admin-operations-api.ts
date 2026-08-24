import {
  adminAccessResponseSchema,
  adminAuditEventListResponseSchema,
  adminHttpRoutes,
  adminInvitationListResponseSchema,
  adminKillSwitchResourceSchema,
  adminUsageSummarySchema,
  adminUserListResponseSchema,
  adminUserQuotaResponseSchema,
  adminUserStatusResponseSchema,
  apiErrorSchema,
  createdInvitationResponseSchema,
  revokedAdminInvitationResponseSchema,
  revokedAdminUserDevicesResponseSchema,
  type AdminAction,
} from "@huayi/cloud-contracts";

import { WebIdentityApiError } from "./identity-api.js";

export interface WebAdminOperationsApiOptions {
  apiOrigin: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

function path(route: string, id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new TypeError("Administrator ID is invalid.");
  return route.replace(":id", encodeURIComponent(id));
}

export function createWebAdminOperationsApi(options: WebAdminOperationsApiOptions) {
  const apiOrigin = new URL(options.apiOrigin);
  if (
    apiOrigin.protocol !== "https:" ||
    apiOrigin.username !== "" ||
    apiOrigin.password !== "" ||
    apiOrigin.pathname !== "/" ||
    apiOrigin.search !== "" ||
    apiOrigin.hash !== ""
  ) {
    throw new TypeError("Huayi API origin is invalid.");
  }
  const request = async (route: string, init?: RequestInit) => {
    const response = await options.fetch(new URL(route, apiOrigin), init);
    if (response.ok) return response;
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    throw new WebIdentityApiError(
      parsed.success ? parsed.data.error.code : "unknown",
      response.status,
    );
  };
  const read = async (route: string) =>
    request(route, { credentials: "include", headers: { Accept: "application/json" } });
  const write = async (
    route: string,
    method: "DELETE" | "POST" | "PUT",
    body: unknown,
    csrfToken: string,
    idempotencyKey: string = crypto.randomUUID(),
  ) =>
    request(route, {
      body: JSON.stringify(body),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-CSRF-Token": csrfToken,
      },
      method,
    });
  let invitationRetryKey: string | null = null;

  const createInvitation = async (
    expiresInHours: number,
    csrfToken: string,
    idempotencyKey: string,
  ) => {
    const response = await write(
      adminHttpRoutes.invitations,
      "POST",
      { expiresInHours },
      csrfToken,
      idempotencyKey,
    );
    const created = createdInvitationResponseSchema.parse(await response.json());
    invitationRetryKey = null;
    return created;
  };

  return {
    async access() {
      return adminAccessResponseSchema.parse(await (await read(adminHttpRoutes.access)).json());
    },
    async createInvitation(expiresInHours: number, csrfToken: string, recover = false) {
      if (recover) {
        if (invitationRetryKey === null) {
          throw new TypeError("Invitation creation recovery is unavailable.");
        }
      } else {
        if (invitationRetryKey !== null) {
          throw new TypeError("Invitation creation recovery is required.");
        }
        invitationRetryKey = crypto.randomUUID();
      }
      return createInvitation(expiresInHours, csrfToken, invitationRetryKey);
    },
    async getUsage() {
      return adminUsageSummarySchema.parse(await (await read(adminHttpRoutes.usage)).json());
    },
    async listAuditEvents(action?: AdminAction, cursor?: string) {
      const url = new URL(adminHttpRoutes.auditEvents, apiOrigin);
      if (action !== undefined) url.searchParams.set("action", action);
      if (cursor !== undefined) url.searchParams.set("cursor", cursor);
      return adminAuditEventListResponseSchema.parse(
        await (await read(`${url.pathname}${url.search}`)).json(),
      );
    },
    async listInvitations(cursor?: string) {
      const url = new URL(adminHttpRoutes.invitations, apiOrigin);
      if (cursor !== undefined) url.searchParams.set("cursor", cursor);
      return adminInvitationListResponseSchema.parse(
        await (await read(`${url.pathname}${url.search}`)).json(),
      );
    },
    async listUsers(query?: string, status?: "active" | "deleting" | "disabled", cursor?: string) {
      const url = new URL(adminHttpRoutes.users, apiOrigin);
      if (query !== undefined && query.trim() !== "") url.searchParams.set("query", query.trim());
      if (status !== undefined) url.searchParams.set("status", status);
      if (cursor !== undefined) url.searchParams.set("cursor", cursor);
      return adminUserListResponseSchema.parse(
        await (await read(`${url.pathname}${url.search}`)).json(),
      );
    },
    async revokeInvitation(id: string, csrfToken: string) {
      const response = await write(path(adminHttpRoutes.invitation, id), "DELETE", {}, csrfToken);
      return revokedAdminInvitationResponseSchema.parse(await response.json());
    },
    async revokeUserDevices(id: string, csrfToken: string) {
      const response = await write(path(adminHttpRoutes.userDevices, id), "POST", {}, csrfToken);
      return revokedAdminUserDevicesResponseSchema.parse(await response.json());
    },
    async setKillSwitch(enabled: boolean, csrfToken: string) {
      const response = await write(adminHttpRoutes.killSwitch, "PUT", { enabled }, csrfToken);
      return adminKillSwitchResourceSchema.parse(await response.json());
    },
    async setUserQuota(id: string, limitMicroUsd: number, periodStart: string, csrfToken: string) {
      const response = await write(
        path(adminHttpRoutes.userQuota, id),
        "PUT",
        { limitMicroUsd, periodStart },
        csrfToken,
      );
      return adminUserQuotaResponseSchema.parse(await response.json());
    },
    async setUserStatus(id: string, action: "disable" | "enable", csrfToken: string) {
      const response = await write(
        path(adminHttpRoutes.userStatus, id),
        "POST",
        { action },
        csrfToken,
      );
      return adminUserStatusResponseSchema.parse(await response.json());
    },
  };
}

export type WebAdminOperationsApi = ReturnType<typeof createWebAdminOperationsApi>;
