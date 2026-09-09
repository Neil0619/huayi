import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import type { Sql, TransactionSql } from "postgres";

export const currentMigrationNames = [
  "0001-cloud-v1-foundation.sql",
  "0002-account-default-quota.sql",
  "0003-password-auth-callback-method.sql",
  "0004-analysis-reservation-fallback.sql",
  "0005-practice-generation-settlement.sql",
  "0006-owner-scoped-analysis-export.sql",
  "0007-analysis-export-owner-wrapper.sql",
  "0008-extension-pairing-atomic-snapshot.sql",
  "0009-account-deletion-replay.sql",
  "0010-quota-lifecycle-and-model-rate-limit.sql",
  "0011-security-notification-delivery.sql",
  "0012-first-operator-bootstrap.sql",
  "0013-password-signup-interruption-recovery.sql",
  "0014-password-signup-otp-resend.sql",
  "0015-public-function-acl-hardening.sql",
  "0016-hosted-deepseek-acceptance-authority.sql",
  "0017-hosted-deepseek-acceptance-retention-scrub.sql",
  "0018-hosted-deepseek-acceptance-status.sql",
  "0019-hosted-deepseek-acceptance-effective-fuse.sql",
  "0020-hosted-deepseek-acceptance-authority-mutations.sql",
  "0021-hosted-deepseek-acceptance-evidence.sql",
  "0022-password-signup-expired-invitation-recovery.sql",
  "0023-invitation-token-recovery.sql",
  "0024-durable-learning-tasks.sql",
  "0025-practice-workspace.sql",
  "0026-email-first-password-signup.sql",
  "0027-error-diagnostics.sql",
  "0028-password-recovery-correctable-retry.sql",
  "0029-wechat-miniprogram.sql",
  "0030-word-archive.sql",
] as const;

/** Every test owns this in-memory database; never connects to an existing service. */
export async function createCurrentDatabaseFixture() {
  const database = new PGlite();
  try {
    await database.waitReady;
    // Reproduce managed Postgres default ACLs before the migrations harden them.
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    `);
    for (const name of currentMigrationNames) {
      await database.exec(
        await readFile(new URL(`../../migrations/${name}`, import.meta.url), "utf8"),
      );
    }
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}

/** Transport adapter only: real identity SQL and its SET LOCAL ROLE execute unchanged. */
export function createPgliteIdentitySql(database: PGlite): Sql {
  return {
    begin: <T>(operation: (sql: TransactionSql) => Promise<T>) =>
      database.transaction((transaction) =>
        operation((async (parts: TemplateStringsArray, ...parameters: unknown[]) => {
          const text = parts.reduce(
            (statement, part, index) => statement + (index ? `$${index}` : "") + part,
            "",
          );
          return (await transaction.query(text, parameters)).rows;
        }) as unknown as TransactionSql),
      ),
  } as unknown as Sql;
}
