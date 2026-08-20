import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresPasswordRecovery } from "./postgres-password-recovery.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userId = "00000000-0000-0000-0000-00000000000a";

function query(database: PGlite): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters: readonly unknown[] = []) =>
      (await database.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres PasswordRecovery repository", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    await database.exec(`
      INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES ('${userId}','${userId}','learner@example.test','active','UTC',5);
      INSERT INTO account_sign_in_methods(owner_user_id,method) VALUES ('${userId}','password');
      INSERT INTO web_sessions(
        id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,expires_at
      ) VALUES (
        '33000000-0000-0000-0000-000000000001','${userId}','${userId}',
        'web-session','web-csrf','refresh',now()+interval '1 day'
      );
    `);
    adapter = {
      async transaction() {
        throw new Error("Password recovery uses only trusted functions.");
      },
      trusted(operation) {
        return database.transaction((transaction) =>
          operation({
            rows: async <Row>(text: string, parameters: readonly unknown[] = []) =>
              (await transaction.query<Row>(text, [...parameters])).rows,
          }),
        );
      },
    };
  });

  afterEach(async () => database.close());

  it("maps opaque secrets through the complete trusted recovery state machine", async () => {
    const clock = new MutableClock("2026-08-14T10:00:00.000Z");
    const repository = createPostgresPasswordRecovery({
      clock,
      database: adapter,
      pepper: "test-pepper-at-least-32-characters",
      protectFlowSecret: (value) => `protected:${value}`,
      secrets: new DeterministicSecrets(),
      unprotectFlowSecret: (value) => value.replace(/^protected:/u, ""),
      webOrigin: "https://app.huayi.example",
    });

    await repository.request({ email: "unknown@example.test", ipBucket: "ip-a" });
    await repository.request({ email: "learner@example.test", ipBucket: "ip-a" });
    const dispatch = await repository.claimDispatch();
    expect(dispatch).toMatchObject({ email: "learner@example.test" });
    expect(dispatch?.flowId).toHaveLength(43);
    expect(dispatch?.leaseId).toHaveLength(43);
    await repository.markDispatched(dispatch?.flowId ?? "", dispatch?.leaseId ?? "");
    await repository.saveSent(
      dispatch?.flowId ?? "",
      dispatch?.leaseId ?? "",
      "protected-provider-state",
    );
    await expect(repository.readProviderState(dispatch?.flowId ?? "")).resolves.toBe(
      "protected-provider-state",
    );

    const browser = await repository.callback(
      dispatch?.flowId ?? "",
      userId,
      "learner@example.test",
      "protected-recovery-session",
    );
    const session = await repository.readSession(
      browser.recoverySessionId,
      "https://app.huayi.example",
    );
    expect(session.csrfToken).not.toBe(browser.csrfToken);
    const completion = await repository.claimCompletion(
      browser.recoverySessionId,
      "https://app.huayi.example",
      session.csrfToken,
    );
    expect(completion).toMatchObject({ flowId: dispatch?.flowId, stage: "verified" });
    await repository.saveProviderUpdated(
      completion.flowId,
      completion.leaseId,
      userId,
      "protected-updated-state",
    );
    await repository.complete(completion.flowId, completion.leaseId);

    const state = await query(database).rows<{
      active_sessions: number;
      notifications: number;
      stage: string;
    }>(`
      SELECT flows.stage,
        (SELECT count(*)::integer FROM web_sessions WHERE revoked_at IS NULL) AS active_sessions,
        (SELECT count(*)::integer FROM security_notification_outbox) AS notifications
      FROM password_recovery_flows flows
    `);
    expect(state).toEqual([{ active_sessions: 0, notifications: 1, stage: "completed" }]);
    const stored = await query(database).rows<{
      callback_flow_ciphertext: string;
      csrf_hash: string | null;
      flow_hash: string;
      recovery_session_hash: string | null;
    }>(`
      SELECT flow_hash,callback_flow_ciphertext,recovery_session_hash,csrf_hash
      FROM password_recovery_flows
    `);
    expect(stored[0]?.flow_hash).not.toBe(dispatch?.flowId);
    expect(stored[0]?.callback_flow_ciphertext).toBe(`protected:${dispatch?.flowId}`);
    expect(stored[0]?.recovery_session_hash).toBeNull();
    expect(stored[0]?.csrf_hash).toBeNull();
  });

  it("maps wrong origin, stale proof, and empty worker state to stable repository outcomes", async () => {
    const repository = createPostgresPasswordRecovery({
      clock: new MutableClock("2026-08-14T10:00:00.000Z"),
      database: adapter,
      pepper: "test-pepper-at-least-32-characters",
      protectFlowSecret: (value) => `protected:${value}`,
      secrets: new DeterministicSecrets(),
      unprotectFlowSecret: (value) => value.replace(/^protected:/u, ""),
      webOrigin: "https://app.huayi.example",
    });

    await expect(repository.claimDispatch()).resolves.toBeUndefined();
    await expect(repository.readSession("missing", "https://attacker.test")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(repository.readProviderState("missing")).rejects.toMatchObject({
      code: "authentication_required",
    });
  });
});
