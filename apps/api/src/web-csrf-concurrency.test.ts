import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import type { Sql, TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { createLearningTaskApp } from "./learning-task-app.js";
import { createPostgresFoundationIdentity } from "./postgres-foundation-identity.js";
import { createPostgresLearningTasks } from "./postgres-learning-tasks.js";
import { createPracticeWorkspace } from "./practice-workspace.js";
import { createPracticeWorkspaceApp } from "./practice-workspace-app.js";
import { authenticateProductionContextRequest } from "./production-extension-authentication.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import { hashSecret, systemClock, systemSecrets } from "./security.js";
import { createFoundationAuthProvider } from "./test-support/foundation-auth-provider.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { authenticateWebAccountRequest } from "./web-account-authentication.js";

const origin = "https://app.huayi.example";
const pepper = "csrf-concurrency-test-pepper-at-least-32-characters";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  for (const file of [
    "0001-cloud-v1-foundation.sql",
    "0024-durable-learning-tasks.sql",
    "0025-practice-workspace.sql",
  ]) {
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
});
afterAll(async () => db.close());

function identity() {
  // Exercise the real tagged SQL adapter and migration functions in a local database.
  const sql = {
    begin: <T>(operation: (sql: TransactionSql) => Promise<T>) =>
      db.transaction((transaction) =>
        operation((async (parts: TemplateStringsArray, ...parameters: unknown[]) => {
          const text = parts.reduce(
            (statement, part, index) => statement + (index ? `$${index}` : "") + part,
            "",
          );
          return (await transaction.query(text, parameters)).rows;
        }) as unknown as TransactionSql),
      ),
  } as unknown as Sql;
  return createPostgresFoundationIdentity({
    clock: systemClock,
    pepper,
    protectRefreshToken: (value) => value,
    secrets: systemSecrets,
    sql,
    webOrigin: origin,
  });
}

async function fixture() {
  const owner = crypto.randomUUID();
  await db.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,$2,'active','UTC',5)",
    [owner, `${owner}@example.test`],
  );
  await db.query(
    "INSERT INTO account_sign_in_methods(owner_user_id,method) VALUES($1,'password')",
    [owner],
  );
  const first = identity();
  const second = identity();
  const session = await first.createWebSession(owner, "protected-refresh");
  const database = createPgliteAnalysisDatabase(db);
  const workspace = createPracticeWorkspace(database);
  const tasks = createPostgresLearningTasks(database);
  const app = createCloudFoundationApp({
    apiOrigin: "https://api.huayi.example",
    auth: createFoundationAuthProvider(),
    identity: first,
    googleLink: first.googleLink,
    passwordLink: first.passwordLink,
    googleAuthenticationEnabled: false,
    protectRefreshToken: (value) => value,
    rateLimiter: createInMemoryRateLimiter(systemClock),
    unprotectRefreshToken: (value) => value,
    webOrigin: origin,
  });
  app.route(
    "/",
    createPracticeWorkspaceApp({
      authenticate: (context) => authenticateWebAccountRequest(second, context),
      workspace,
    }),
  );
  app.route(
    "/",
    createLearningTaskApp({
      authenticate: (context) =>
        authenticateProductionContextRequest(second, context, { capability: "disabled" }),
      store: tasks,
      cronSecret: "unused-offline-cron-secret-at-least-32",
      runWorker: async () => undefined,
    }),
  );
  const cookie = `huayi_session=${session.sessionId}`;
  const bootstrap = async () => {
    const response = await app.request("/v1/auth/csrf", { headers: { cookie, origin } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    return (await response.json()) as { access: string; csrfToken: string };
  };
  return { app, bootstrap, cookie, first, owner, second, session, tasks, workspace };
}

describe("Web CSRF across concurrent requests and API instances", () => {
  it.each([false, true])(
    "persists both autosave and submitted reply when another tab bootstraps: %s",
    async (anotherTab) => {
      const { app, bootstrap, cookie, owner, tasks, workspace } = await fixture();
      const itemId = crypto.randomUUID();
      await db.query(
        `INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content)
         VALUES($1,$2,'expression','at least',
           '{"type":"expression","text":"at least","meaningZh":"至少","usageZh":"说明最小数量。"}');`,
        [itemId, owner],
      );
      await db.query(
        "INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at) VALUES($1,$2,-1,NULL)",
        [itemId, owner],
      );
      const practice = await workspace.start(owner, { itemId, mode: "free" }, "start");
      const [draftProof, replyProof] = await Promise.all([bootstrap(), bootstrap()]);
      if (anotherTab) await bootstrap();
      const draft = "I read at least one page every day.";
      const post = (path: string, csrfToken: string, body: unknown) =>
        app.request(path, {
          method: "POST",
          headers: {
            cookie,
            origin,
            "x-csrf-token": csrfToken,
            "content-type": "application/json",
            "idempotency-key": "reply-once",
          },
          body: JSON.stringify(body),
        });
      const command = {
        version: 2,
        kind: "sentence-submit",
        sessionId: practice.id,
        input: { expectedRevision: practice.revision, answer: draft },
      };
      const responses = await Promise.all([
        post(`/v2/practice-workspace/${practice.id}/draft`, draftProof.csrfToken, {
          draft,
          expectedDraftRevision: 0,
        }),
        post("/v2/learning-tasks", replyProof.csrfToken, command),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 202]);
      expect((await workspace.get(owner, practice.id)).workspace?.draft).toBe(draft);
      expect(await tasks.list(owner)).toMatchObject([{ state: "queued", kind: "sentence-submit" }]);
      expect((await post("/v2/learning-tasks", draftProof.csrfToken, command)).status).toBe(202);
      expect(await tasks.list(owner)).toHaveLength(1);
    },
  );

  it("keeps the login proof usable while rejecting wrong origins and other sessions' tokens", async () => {
    const { app, bootstrap, cookie, first, owner, second, session } = await fixture();
    const other = await first.createWebSession(owner, "another-refresh");
    await Promise.all([bootstrap(), bootstrap()]);
    await expect(
      second.authenticateWebMutation(session.sessionId, origin, session.csrfToken),
    ).resolves.toMatchObject({ userId: owner });
    await expect(
      second.authenticateWebMutation(session.sessionId, origin, other.csrfToken),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      second.authenticateWebMutation(session.sessionId, "https://evil.example", session.csrfToken),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (await app.request("/v1/auth/csrf", { headers: { cookie, origin: "https://evil.example" } }))
        .status,
    ).toBe(401);
    expect((await app.request("/v1/auth/csrf", { headers: { origin } })).status).toBe(401);
    await first.revokeWebSession(session.sessionId);
    expect((await app.request("/v1/auth/csrf", { headers: { cookie, origin } })).status).toBe(401);
    await expect(
      second.authenticateWebMutation(session.sessionId, origin, session.csrfToken),
    ).rejects.toMatchObject({ code: "authentication_required" });
  });

  it("rotates proof with password reauthentication and refuses expired sessions", async () => {
    const { first, owner, second, session } = await fixture();
    const replacement = await first.completePasswordReauthentication(
      session.sessionId,
      owner,
      "new-refresh",
    );
    expect(replacement.csrfToken).not.toBe(session.csrfToken);
    await second.bootstrapWebCsrf(replacement.sessionId);
    await expect(
      first.authenticateWebMutation(replacement.sessionId, origin, replacement.csrfToken),
    ).resolves.toMatchObject({ userId: owner });
    await expect(
      first.authenticateWebMutation(replacement.sessionId, origin, session.csrfToken),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      first.authenticateWebMutation(session.sessionId, origin, session.csrfToken),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await db.query(
      "UPDATE web_sessions SET expires_at=now()-interval '1 second' WHERE session_hash=$1",
      [hashSecret(replacement.sessionId, pepper)],
    );
    await expect(first.bootstrapWebCsrf(replacement.sessionId)).rejects.toMatchObject({
      code: "authentication_required",
    });
  });

  it("synchronizes an existing random proof once without reviving a revoked session", async () => {
    const { bootstrap, first, owner, second, session } = await fixture();
    const legacy = "legacy-random-proof-before-deployment";
    await db.query("UPDATE web_sessions SET csrf_hash=$2 WHERE session_hash=$1", [
      hashSecret(session.sessionId, pepper),
      hashSecret(legacy, pepper),
    ]);
    const [one, two] = await Promise.all([bootstrap(), bootstrap()]);
    for (const proof of [one.csrfToken, two.csrfToken]) {
      await expect(
        second.authenticateWebMutation(session.sessionId, origin, proof),
      ).resolves.toMatchObject({ userId: owner });
    }
    await expect(
      first.authenticateWebMutation(session.sessionId, origin, legacy),
    ).rejects.toMatchObject({ code: "forbidden" });
    await first.revokeWebSession(session.sessionId);
    await expect(second.bootstrapWebCsrf(session.sessionId)).rejects.toMatchObject({
      code: "authentication_required",
    });
  });

  it("keeps disabled accounts limited to data rights and rejects session hashes as proof", async () => {
    const { first, owner, second, session } = await fixture();
    await db.query("UPDATE user_profiles SET status='disabled' WHERE user_id=$1", [owner]);
    await expect(first.bootstrapWebCsrf(session.sessionId)).rejects.toMatchObject({
      code: "authentication_required",
    });
    const limited = await first.createWebSession(owner, "data-rights-refresh");
    const proofs = await Promise.all([
      first.bootstrapWebCsrf(limited.sessionId),
      second.bootstrapWebCsrf(limited.sessionId),
    ]);
    for (const proof of proofs) {
      expect(proof.access).toBe("data-rights");
      await expect(
        first.authenticateDataRightsMutation(limited.sessionId, origin, proof.csrfToken),
      ).resolves.toMatchObject({ userId: owner, access: "data-rights" });
      await expect(
        first.authenticateWebMutation(limited.sessionId, origin, proof.csrfToken),
      ).rejects.toMatchObject({ code: "authentication_required" });
    }
    await expect(
      first.authenticateDataRightsMutation(
        limited.sessionId,
        origin,
        hashSecret(limited.sessionId, pepper),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
