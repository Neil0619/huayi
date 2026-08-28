import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationUrls = [
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
].map((name) => new URL(`../migrations/${name}`, import.meta.url));

describe("Cloud V1 current migration chain", () => {
  let database: PGlite | undefined;

  afterEach(async () => database?.close());

  it("applies the current baseline followed by every forward migration", async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    `);

    for (const migrationUrl of migrationUrls) {
      await expect(database.exec(await readFile(migrationUrl, "utf8"))).resolves.toBeDefined();
    }
  });
});
