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
  adminWriteHeadersSchema,
  createdInvitationResponseSchema,
  listAdminAuditEventsQuerySchema,
  listAdminInvitationsQuerySchema,
  listAdminUsersQuerySchema,
  resourceIdSchema,
  recoveredInvitationTokenResponseSchema,
  revokedAdminInvitationResponseSchema,
  revokedAdminUserDevicesResponseSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

import type { AdminAuthorization, AdminOperationsModule } from "./admin-operations-module.js";
import { CloudFault } from "./cloud-fault.js";

async function json(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new CloudFault("invalid_request", "Expected JSON.");
  }
}

function key(context: Context): string {
  return adminWriteHeadersSchema.parse({
    "idempotency-key": context.req.header("idempotency-key"),
  })["idempotency-key"];
}

function noStore(context: Context): void {
  context.header("Cache-Control", "private, no-store");
}

export function createAdminOperationsApp(options: {
  authenticate(
    context: Context,
    mutation: boolean,
  ): AdminAuthorization | Promise<AdminAuthorization>;
  module: AdminOperationsModule;
}) {
  const app = new Hono();
  const authenticate = async (context: Context, mutation: boolean) => {
    const authorization = await options.authenticate(context, mutation);
    noStore(context);
    return authorization;
  };

  app.get(adminHttpRoutes.access, async (context) =>
    context.json(
      adminAccessResponseSchema.parse(
        await options.module.access(await authenticate(context, false)),
      ),
    ),
  );
  app.get(adminHttpRoutes.users, async (context) =>
    context.json(
      adminUserListResponseSchema.parse(
        await options.module.listUsers(
          await authenticate(context, false),
          listAdminUsersQuerySchema.parse(context.req.query()),
        ),
      ),
    ),
  );
  app.get(adminHttpRoutes.invitations, async (context) =>
    context.json(
      adminInvitationListResponseSchema.parse(
        await options.module.listInvitations(
          await authenticate(context, false),
          listAdminInvitationsQuerySchema.parse(context.req.query()),
        ),
      ),
    ),
  );
  app.get(adminHttpRoutes.auditEvents, async (context) =>
    context.json(
      adminAuditEventListResponseSchema.parse(
        await options.module.listAuditEvents(
          await authenticate(context, false),
          listAdminAuditEventsQuerySchema.parse(context.req.query()),
        ),
      ),
    ),
  );
  app.get(adminHttpRoutes.usage, async (context) =>
    context.json(
      adminUsageSummarySchema.parse(await options.module.usage(await authenticate(context, false))),
    ),
  );

  app.post(adminHttpRoutes.invitations, async (context) =>
    context.json(
      createdInvitationResponseSchema.parse(
        await options.module.execute(await authenticate(context, true), {
          body: await json(context),
          idempotencyKey: key(context),
          type: "create-invitation",
        }),
      ),
      201,
    ),
  );
  app.delete(adminHttpRoutes.invitation, async (context) =>
    context.json(
      revokedAdminInvitationResponseSchema.parse(
        await options.module.execute(await authenticate(context, true), {
          body: await json(context),
          id: resourceIdSchema.parse(context.req.param("id")),
          idempotencyKey: key(context),
          type: "revoke-invitation",
        }),
      ),
    ),
  );
  app.post(adminHttpRoutes.invitationTokenRecovery, async (context) =>
    context.json(
      recoveredInvitationTokenResponseSchema.parse(
        await options.module.execute(await authenticate(context, true), {
          body: await json(context),
          id: resourceIdSchema.parse(context.req.param("id")),
          idempotencyKey: key(context),
          type: "recover-invitation-token",
        }),
      ),
    ),
  );
  app.post(adminHttpRoutes.userStatus, async (context) =>
    context.json(
      adminUserStatusResponseSchema.parse(
        await options.module.execute(await authenticate(context, true), {
          body: await json(context),
          id: resourceIdSchema.parse(context.req.param("id")),
          idempotencyKey: key(context),
          type: "set-user-status",
        }),
      ),
    ),
  );
  app.post(adminHttpRoutes.userDevices, async (context) =>
    context.json(
      revokedAdminUserDevicesResponseSchema.parse(
        await options.module.execute(await authenticate(context, true), {
          body: await json(context),
          id: resourceIdSchema.parse(context.req.param("id")),
          idempotencyKey: key(context),
          type: "revoke-user-devices",
        }),
      ),
    ),
  );
  app.put(adminHttpRoutes.userQuota, async (context) =>
    context.json(
      adminUserQuotaResponseSchema.parse(
        await options.module.execute(await authenticate(context, true), {
          body: await json(context),
          id: resourceIdSchema.parse(context.req.param("id")),
          idempotencyKey: key(context),
          type: "set-user-quota",
        }),
      ),
    ),
  );
  app.put(adminHttpRoutes.killSwitch, async (context) =>
    context.json(
      adminKillSwitchResourceSchema.parse(
        await options.module.execute(await authenticate(context, true), {
          body: await json(context),
          idempotencyKey: key(context),
          type: "set-kill-switch",
        }),
      ),
    ),
  );
  return app;
}
