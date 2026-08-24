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
].map((name) => new URL(`../migrations/${name}`, import.meta.url));

describe("Cloud V1 current migration chain", () => {
  let database: PGlite | undefined;

  afterEach(async () => database?.close());

  it("applies the current baseline followed by every forward migration", async () => {
    database = new PGlite();
    await database.waitReady;

    for (const migrationUrl of migrationUrls) {
      await expect(database.exec(await readFile(migrationUrl, "utf8"))).resolves.toBeDefined();
    }
  });
});
