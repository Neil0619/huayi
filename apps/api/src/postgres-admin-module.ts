import type { Sql, TransactionSql } from "postgres";

import { CloudFault } from "./cloud-fault.js";
import { hashSecret, opaqueSecret, type Clock, type SecretSource } from "./security.js";

interface Authorization {
  actorUserId: string;
  reauthenticatedAt: Date;
}

export function createPostgresAdminModule(options: {
  clock: Clock;
  pepper: string;
  secrets: SecretSource;
  sql: Sql;
}) {
  function authorize(authorization: Authorization): void {
    const age = options.clock.now().getTime() - authorization.reauthenticatedAt.getTime();
    if (age < 0 || age > 15 * 60 * 1_000) {
      throw new CloudFault("forbidden", "Recent administrator authentication is required.");
    }
  }

  async function trusted<T>(operation: (sql: TransactionSql) => Promise<T>): Promise<T> {
    return options.sql.begin(async (sql) => {
      await sql`SET LOCAL ROLE huayi_context_setter`;
      return operation(sql);
    }) as Promise<T>;
  }

  async function requireOperator(sql: TransactionSql, authorization: Authorization): Promise<void> {
    authorize(authorization);
    const [role] = await sql<{ role: string | null }[]>`
      SELECT require_admin_operator(${authorization.actorUserId}) AS role
    `;
    if (role?.role !== "operator") {
      throw new CloudFault("forbidden", "Administrator permission is required.");
    }
  }

  return {
    async createInvitation(authorization: Authorization, expiresInHours = 72) {
      const token = opaqueSecret(options.secrets);
      const id = crypto.randomUUID();
      const createdAt = options.clock.now();
      const expiresAt = new Date(createdAt.getTime() + expiresInHours * 60 * 60 * 1_000);
      await trusted(async (sql) => {
        await requireOperator(sql, authorization);
        await sql`SELECT admin_create_invitation(
          ${id}, ${hashSecret(token, options.pepper)}, ${expiresAt}, ${authorization.actorUserId},
          ${crypto.randomUUID()}
        )`;
      });
      return {
        consumedAt: null,
        createdAt,
        createdBy: authorization.actorUserId,
        expiresAt,
        id,
        revokedAt: null,
        token,
      };
    },

    async revokeDevices(authorization: Authorization, userId: string) {
      await trusted(async (sql) => {
        await requireOperator(sql, authorization);
        await sql`SELECT admin_revoke_devices(
          ${authorization.actorUserId}, ${userId}, ${crypto.randomUUID()}
        )`;
      });
    },

    async setQuota(
      authorization: Authorization,
      userId: string,
      limitMicroUsd: number,
      periodStart = options.clock.now(),
    ) {
      await trusted(async (sql) => {
        await requireOperator(sql, authorization);
        const utcStart = new Date(
          Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1),
        );
        const utcEnd = new Date(
          Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1),
        );
        await sql`SELECT admin_set_quota(
          ${authorization.actorUserId}, ${userId}, ${crypto.randomUUID()}, ${utcStart}, ${utcEnd},
          ${limitMicroUsd}, ${crypto.randomUUID()}
        )`;
      });
    },

    async setUserStatus(
      authorization: Authorization,
      userId: string,
      status: "active" | "disabled",
    ) {
      await trusted(async (sql) => {
        await requireOperator(sql, authorization);
        await sql`SELECT admin_set_user_status(
          ${authorization.actorUserId}, ${userId}, ${status}, ${crypto.randomUUID()}
        )`;
      });
    },
  };
}
