import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import type { Sql, TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { parseApiEnvironment } from "./environment.js";
import { createPostgresFoundationIdentity } from "./postgres-foundation-identity.js";
import { createProductionAdminOperations } from "./production-admin-operations.js";
import { createProductionDiagnostics } from "./production-diagnostics.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import { hashSecret, systemClock, systemSecrets } from "./security.js";
import { createFoundationAuthProvider } from "./test-support/foundation-auth-provider.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";

const origin = "https://app.huayi.example";
const pepper = "operator-session-test-pepper-at-least-32-characters";
const environment = parseApiEnvironment({
  CRON_SECRET: "cron-test-secret-at-least-32-characters",
  HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports",
  HUAYI_API_ORIGIN: "https://api.huayi.example",
  HUAYI_DATABASE_TLS_CA_BASE64: Buffer.from(
    "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----\n",
  ).toString("base64"),
  HUAYI_DATABASE_URL:
    "postgresql://app.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
  HUAYI_DEEPSEEK_API_KEY: "deepseek-test-key-at-least-20-characters",
  HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000001",
  HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000002",
  HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000003",
  HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
  HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
  HUAYI_RESEND_API_KEY: "re_test-only-not-a-real-secret",
  HUAYI_SECRET_PEPPER: pepper,
  HUAYI_SECURITY_NOTIFICATION_FROM: "语见 <security@notify.example.test>",
  HUAYI_SECURITY_NOTIFICATION_MODE: "resend",
  HUAYI_SECURITY_NOTIFICATION_REPLY_TO: "support@example.test",
  HUAYI_STORE_EXTENSION_CAPABILITY: "disabled",
  HUAYI_WEB_ORIGIN: origin,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
  SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_test-value",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
});
const readPaths = [
  "/v1/admin/access",
  "/v1/admin/users",
  "/v1/admin/invitations",
  "/v1/admin/audit-events",
  "/v1/admin/usage",
  "/v1/admin/error-logs",
];
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  for (const file of [
    "0001-cloud-v1-foundation.sql",
    "0024-durable-learning-tasks.sql",
    "0027-error-diagnostics.sql",
  ]) {
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
});
afterAll(async () => db.close());

async function fixture(operator = true) {
  // Only bridge the driver syntax: identity and authorization execute the real SQL functions.
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
  const identity = createPostgresFoundationIdentity({
    clock: systemClock,
    pepper,
    protectRefreshToken: (value) => value,
    secrets: systemSecrets,
    sql,
    webOrigin: origin,
  });
  const owner = crypto.randomUUID();
  await db.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,$2,'active','UTC',5)",
    [owner, `${owner}@example.test`],
  );
  if (operator)
    await db.query("INSERT INTO admin_roles(user_id,role) VALUES($1,'operator')", [owner]);
  const session = await identity.createWebSession(owner, "protected-refresh");
  const sessionHash = hashSecret(session.sessionId, pepper);
  await db.query(
    "UPDATE web_sessions SET reauthenticated_at=now()-interval '1 hour' WHERE session_hash=$1",
    [sessionHash],
  );
  const database = createPgliteAnalysisDatabase(db);
  const rateLimiter = createInMemoryRateLimiter(systemClock);
  const app = createCloudFoundationApp({
    apiOrigin: environment.HUAYI_API_ORIGIN,
    auth: createFoundationAuthProvider(),
    identity,
    googleLink: identity.googleLink,
    passwordLink: identity.passwordLink,
    googleAuthenticationEnabled: false,
    protectRefreshToken: (value) => value,
    unprotectRefreshToken: (value) => value,
    rateLimiter,
    webOrigin: origin,
  });
  app.route("/", createProductionAdminOperations({ database, environment, identity }));
  app.route(
    "/",
    createProductionDiagnostics({
      database,
      environment,
      identity,
      policy: { capability: "disabled" },
      rateLimiter,
    }).app,
  );
  return { app, owner, sessionHash, session, cookie: `huayi_session=${session.sessionId}` };
}

describe("production operator session boundary", () => {
  it("permits all metadata reads with an old but valid operator session", async () => {
    const { app, cookie } = await fixture();
    for (const path of readPaths) {
      const response = await app.request(path, { headers: { cookie } });
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it.each([
    "missing",
    "extension-only",
    "expired",
    "revoked",
    "disabled",
    "data-rights",
    "non-operator",
    "role-revoked",
  ] as const)("denies %s before returning admin data", async (state) => {
    const { app, cookie, owner, sessionHash } = await fixture(state !== "non-operator");
    const headers: Record<string, string> = { cookie };
    if (state === "missing" || state === "extension-only") delete headers.cookie;
    if (state === "extension-only") headers.authorization = `HuayiExtension ${"s".repeat(43)}`;
    if (state === "expired")
      await db.query(
        "UPDATE web_sessions SET expires_at=now()-interval '1 second' WHERE session_hash=$1",
        [sessionHash],
      );
    if (state === "revoked")
      await db.query("UPDATE web_sessions SET revoked_at=now() WHERE session_hash=$1", [
        sessionHash,
      ]);
    if (state === "disabled")
      await db.query("UPDATE user_profiles SET status='disabled' WHERE user_id=$1", [owner]);
    if (state === "data-rights")
      await db.query("UPDATE web_sessions SET access_scope='data-rights' WHERE session_hash=$1", [
        sessionHash,
      ]);
    if (state === "role-revoked") {
      expect((await app.request(readPaths[0] ?? "", { headers })).status).toBe(200);
      await db.query("DELETE FROM admin_roles WHERE user_id=$1", [owner]);
    }
    for (const path of readPaths) {
      const response = await app.request(path, { headers });
      expect(response.status, path).toBe(
        state === "non-operator" || state === "role-revoked" ? 403 : 401,
      );
      expect(await response.json()).toHaveProperty("error");
    }
  });

  it("keeps recent authentication, origin and session-bound CSRF mandatory for writes", async () => {
    const { app, cookie, session, sessionHash, owner } = await fixture();
    const headers = {
      cookie,
      origin,
      "x-csrf-token": session.csrfToken,
      "content-type": "application/json",
      "idempotency-key": "operator-proof-test",
    };
    const create = (proof: Record<string, string>) =>
      app.request("/v1/admin/invitations", {
        method: "POST",
        headers: proof,
        body: JSON.stringify({ expiresInHours: 24 }),
      });
    expect((await create(headers)).status).toBe(403);
    await db.query("UPDATE web_sessions SET reauthenticated_at=now() WHERE session_hash=$1", [
      sessionHash,
    ]);
    const missingOrigin: Record<string, string> = { ...headers };
    delete missingOrigin.origin;
    const missingCsrf: Record<string, string> = { ...headers };
    delete missingCsrf["x-csrf-token"];
    for (const proof of [
      missingOrigin,
      missingCsrf,
      { ...headers, origin: "https://untrusted.example" },
      { ...headers, "x-csrf-token": "another-session-proof" },
    ]) {
      expect((await create(proof)).status).toBe(403);
    }
    expect(
      (
        await db.query("SELECT count(*)::integer AS count FROM invitations WHERE created_by=$1", [
          owner,
        ])
      ).rows,
    ).toEqual([{ count: 0 }]);
    expect((await create(headers)).status).toBe(201);
    expect(
      (
        await db.query("SELECT count(*)::integer AS count FROM invitations WHERE created_by=$1", [
          owner,
        ])
      ).rows,
    ).toEqual([{ count: 1 }]);
  });
});
