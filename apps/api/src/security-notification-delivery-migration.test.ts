import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const forwardMigrationUrl = new URL(
  "../migrations/0011-security-notification-delivery.sql",
  import.meta.url,
);
const supabaseForwardMigrationUrl = new URL(
  "../../../supabase/migrations/20260822020000_security_notification_delivery.sql",
  import.meta.url,
);
const ownerId = "00000000-0000-0000-0000-00000000000a";

describe("security notification delivery database state machine", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES ('${ownerId}','${ownerId}','learner@example.test','active','UTC',5);
      INSERT INTO security_notification_outbox(
        id,owner_user_id,kind,status,attempt_count,available_at,created_at,delivery_deadline_at
      ) VALUES
        ('32000000-0000-0000-0000-000000000001','${ownerId}','password-reset-completed',
         'pending',0,'2026-08-14T09:00:00Z','2026-08-14T09:00:00Z','2026-08-15T08:00:00Z'),
        ('32000000-0000-0000-0000-000000000002','${ownerId}','password-reset-completed',
         'pending',8,'2026-08-14T09:00:00Z','2026-08-14T10:00:00Z','2026-08-15T09:00:00Z'),
        ('32000000-0000-0000-0000-000000000003','${ownerId}','password-reset-completed',
         'pending',7,'2026-08-14T09:00:00Z','2026-08-14T10:00:01Z','2026-08-15T09:00:01Z');
    `);
  });

  afterEach(async () => database.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    await expect(readFile(supabaseForwardMigrationUrl, "utf8")).resolves.toBe(
      await readFile(forwardMigrationUrl, "utf8"),
    );
  });

  it("terminalizes expired and exhausted rows before claiming one bounded eighth attempt", async () => {
    const terminalized = await database.query<{
      deadline_exceeded_count: number;
      maximum_attempts_exceeded_count: number;
      notification_id: string | null;
      outcome: string;
    }>(`
      SELECT outcome,notification_id::text,deadline_exceeded_count,
        maximum_attempts_exceeded_count
      FROM claim_security_notification(
        'lease-terminal','2026-08-15T08:01:00Z','2026-08-15T08:00:00Z'
      )
    `);
    expect(terminalized.rows).toEqual([
      {
        deadline_exceeded_count: 1,
        maximum_attempts_exceeded_count: 1,
        notification_id: null,
        outcome: "terminalized",
      },
    ]);

    const delivery = await database.query<{
      attempt_count: number;
      delivery_deadline_at: Date;
      email: string;
      notification_id: string;
      outcome: string;
    }>(`
      SELECT outcome,notification_id::text,email,attempt_count,delivery_deadline_at
      FROM claim_security_notification(
        'lease-delivery','2026-08-15T08:02:00Z','2026-08-15T08:00:00Z'
      )
    `);
    expect(delivery.rows).toEqual([
      {
        attempt_count: 8,
        delivery_deadline_at: new Date("2026-08-15T09:00:01.000Z"),
        email: "learner@example.test",
        notification_id: "32000000-0000-0000-0000-000000000003",
        outcome: "delivery",
      },
    ]);
    await expect(
      database.query(`
      SELECT retry_security_notification(
        '32000000-0000-0000-0000-000000000003','lease-delivery',
        '2026-08-15T08:01:01Z','2026-08-15T08:00:30Z'
      ) AS saved
    `),
    ).resolves.toMatchObject({ rows: [{ saved: true }] });
    await expect(
      database.query(`
      SELECT id::text,status FROM security_notification_outbox ORDER BY id
    `),
    ).resolves.toMatchObject({
      rows: [{ status: "failed" }, { status: "dead-letter" }, { status: "dead-letter" }],
    });
  });

  it("rejects a deadline that is not exactly 23 hours after creation", async () => {
    await expect(
      database.exec(`
      INSERT INTO security_notification_outbox(
        id,owner_user_id,kind,created_at,delivery_deadline_at
      ) VALUES (
        '32000000-0000-0000-0000-000000000004','${ownerId}','password-reset-completed',
        '2026-08-14T10:00:00Z','2026-08-15T10:00:00Z'
      )
    `),
    ).rejects.toThrow();
  });
});
