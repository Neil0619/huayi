import { createHash, createHmac } from "node:crypto";

import {
  adminAuditEventListResponseSchema,
  adminInvitationListResponseSchema,
  adminUsageSummarySchema,
  adminUserListResponseSchema,
  createAdminInvitationRequestSchema,
  listAdminAuditEventsQuerySchema,
  listAdminInvitationsQuerySchema,
  listAdminUsersQuerySchema,
  resourceIdSchema,
  recoverAdminInvitationTokenRequestSchema,
  revokeAdminInvitationRequestSchema,
  revokeAdminUserDevicesRequestSchema,
  setAdminKillSwitchRequestSchema,
  setAdminQuotaRequestSchema,
  setAdminUserStatusRequestSchema,
  type AdminAuditEvent,
  type AdminUsageSummary,
  type AdminUserResource,
  type InvitationResource,
} from "@huayi/cloud-contracts";

import { createAdminOperationsCursor } from "./admin-operations-cursor.js";

export interface AdminAuthorization {
  actorUserId: string;
  reauthenticatedAt: Date;
}
interface Boundary {
  createdAt: string;
  id: string;
}

interface Page<T> {
  items: T[];
  next: Boundary | null;
}

export type AdminCommand =
  | { body: unknown; idempotencyKey: string; type: "create-invitation" }
  | { body: unknown; id: string; idempotencyKey: string; type: "revoke-invitation" }
  | { body: unknown; id: string; idempotencyKey: string; type: "recover-invitation-token" }
  | { body: unknown; id: string; idempotencyKey: string; type: "set-user-status" }
  | { body: unknown; id: string; idempotencyKey: string; type: "revoke-user-devices" }
  | { body: unknown; id: string; idempotencyKey: string; type: "set-user-quota" }
  | { body: unknown; idempotencyKey: string; type: "set-kill-switch" };

export type AdminRepositoryCommand =
  | {
      expiresInHours: number;
      id: string;
      idempotencyKey: string;
      requestHash: string;
      token: string;
      type: "create-invitation";
    }
  | {
      id: string;
      idempotencyKey: string;
      requestHash: string;
      type: "revoke-invitation" | "revoke-user-devices";
    }
  | {
      id: string;
      idempotencyKey: string;
      requestHash: string;
      token: string;
      type: "recover-invitation-token";
    }
  | {
      action: "disable" | "enable";
      id: string;
      idempotencyKey: string;
      requestHash: string;
      type: "set-user-status";
    }
  | {
      id: string;
      idempotencyKey: string;
      limitMicroUsd: number;
      periodStart: string;
      requestHash: string;
      type: "set-user-quota";
    }
  | {
      enabled: boolean;
      idempotencyKey: string;
      requestHash: string;
      type: "set-kill-switch";
    };

export interface AdminOperationsRepository {
  access(authorization: AdminAuthorization): Promise<void>;
  execute(authorization: AdminAuthorization, command: AdminRepositoryCommand): Promise<unknown>;
  listAuditEvents(
    authorization: AdminAuthorization,
    query: { action?: string; boundary?: Boundary; limit: number },
  ): Promise<Page<AdminAuditEvent>>;
  listInvitations(
    authorization: AdminAuthorization,
    query: { boundary?: Boundary; limit: number },
  ): Promise<Page<InvitationResource>>;
  listUsers(
    authorization: AdminAuthorization,
    query: { boundary?: Boundary; limit: number; query?: string; status?: string },
  ): Promise<Page<AdminUserResource>>;
  usage(authorization: AdminAuthorization): Promise<AdminUsageSummary>;
}

function digest(operation: string, body: unknown, id?: string): string {
  return createHash("sha256").update(JSON.stringify({ body, id, operation })).digest("hex");
}

export function createAdminOperationsModule(options: {
  cursorKey: Uint8Array;
  ids(): string;
  invitationRecoveryTokenKey: Uint8Array;
  invitationTokenKey: Uint8Array;
  repository: AdminOperationsRepository;
}) {
  if (options.invitationRecoveryTokenKey.byteLength < 32) {
    throw new Error("Invitation recovery token key must contain at least 256 bits.");
  }
  if (options.invitationTokenKey.byteLength < 32) {
    throw new Error("Invitation token key must contain at least 256 bits.");
  }
  const cursor = createAdminOperationsCursor(options.cursorKey);
  const list = async <T, R>(
    kind: "audit" | "invitations" | "users",
    result: Promise<Page<T>>,
    schema: { parse(value: unknown): R },
  ): Promise<R> => {
    const page = await result;
    return schema.parse({
      items: page.items,
      nextCursor: page.next === null ? null : cursor.encode(kind, page.next),
    });
  };
  return {
    async access(authorization: AdminAuthorization) {
      await options.repository.access(authorization);
      return { role: "operator" as const };
    },
    async execute(authorization: AdminAuthorization, command: AdminCommand) {
      const id = "id" in command ? resourceIdSchema.parse(command.id) : undefined;
      if (command.type === "create-invitation") {
        const body = createAdminInvitationRequestSchema.parse(command.body);
        const expiresInHours = body.expiresInHours ?? 72;
        const requestHash = digest(command.type, body);
        const token = createHmac("sha256", options.invitationTokenKey)
          .update(`${authorization.actorUserId}\0${command.idempotencyKey}\0${requestHash}`)
          .digest("base64url");
        const invitation = (await options.repository.execute(authorization, {
          expiresInHours,
          id: options.ids(),
          idempotencyKey: command.idempotencyKey,
          requestHash,
          token,
          type: command.type,
        })) as Record<string, unknown>;
        return { ...invitation, invitationPath: `/join#${token}` };
      }
      if (command.type === "revoke-invitation") {
        const body = revokeAdminInvitationRequestSchema.parse(command.body);
        return options.repository.execute(authorization, {
          id: id ?? "",
          idempotencyKey: command.idempotencyKey,
          requestHash: digest(command.type, body, id),
          type: command.type,
        });
      }
      if (command.type === "recover-invitation-token") {
        const body = recoverAdminInvitationTokenRequestSchema.parse(command.body);
        const requestHash = digest(command.type, body, id);
        const token = createHmac("sha256", options.invitationRecoveryTokenKey)
          .update(
            `token-recovery\0${authorization.actorUserId}\0${command.idempotencyKey}\0${requestHash}`,
          )
          .digest("base64url");
        const recovered = (await options.repository.execute(authorization, {
          id: id ?? "",
          idempotencyKey: command.idempotencyKey,
          requestHash,
          token,
          type: command.type,
        })) as Record<string, unknown>;
        return { ...recovered, invitationPath: `/join#${token}` };
      }
      if (command.type === "revoke-user-devices") {
        const body = revokeAdminUserDevicesRequestSchema.parse(command.body);
        return options.repository.execute(authorization, {
          id: id ?? "",
          idempotencyKey: command.idempotencyKey,
          requestHash: digest(command.type, body, id),
          type: command.type,
        });
      }
      if (command.type === "set-user-status") {
        const body = setAdminUserStatusRequestSchema.parse(command.body);
        return options.repository.execute(authorization, {
          action: body.action,
          id: id ?? "",
          idempotencyKey: command.idempotencyKey,
          requestHash: digest(command.type, body, id),
          type: command.type,
        });
      }
      if (command.type === "set-user-quota") {
        const body = setAdminQuotaRequestSchema.parse(command.body);
        return options.repository.execute(authorization, {
          id: id ?? "",
          idempotencyKey: command.idempotencyKey,
          limitMicroUsd: body.limitMicroUsd,
          periodStart: body.periodStart,
          requestHash: digest(command.type, body, id),
          type: command.type,
        });
      }
      const body = setAdminKillSwitchRequestSchema.parse(command.body);
      return options.repository.execute(authorization, {
        enabled: body.enabled,
        idempotencyKey: command.idempotencyKey,
        requestHash: digest(command.type, body),
        type: command.type,
      });
    },
    async listAuditEvents(authorization: AdminAuthorization, input: unknown) {
      const query = listAdminAuditEventsQuerySchema.parse(input);
      return list(
        "audit",
        options.repository.listAuditEvents(authorization, {
          ...(query.action === undefined ? {} : { action: query.action }),
          ...(query.cursor === undefined ? {} : { boundary: cursor.decode(query.cursor, "audit") }),
          limit: query.limit ?? 20,
        }),
        adminAuditEventListResponseSchema,
      );
    },
    async listInvitations(authorization: AdminAuthorization, input: unknown) {
      const query = listAdminInvitationsQuerySchema.parse(input);
      return list(
        "invitations",
        options.repository.listInvitations(authorization, {
          ...(query.cursor === undefined
            ? {}
            : { boundary: cursor.decode(query.cursor, "invitations") }),
          limit: query.limit ?? 20,
        }),
        adminInvitationListResponseSchema,
      );
    },
    async listUsers(authorization: AdminAuthorization, input: unknown) {
      const query = listAdminUsersQuerySchema.parse(input);
      return list(
        "users",
        options.repository.listUsers(authorization, {
          ...(query.cursor === undefined ? {} : { boundary: cursor.decode(query.cursor, "users") }),
          limit: query.limit ?? 20,
          ...(query.query === undefined ? {} : { query: query.query }),
          ...(query.status === undefined ? {} : { status: query.status }),
        }),
        adminUserListResponseSchema,
      );
    },
    async usage(authorization: AdminAuthorization) {
      return adminUsageSummarySchema.parse(await options.repository.usage(authorization));
    },
  };
}

export type AdminOperationsModule = ReturnType<typeof createAdminOperationsModule>;
