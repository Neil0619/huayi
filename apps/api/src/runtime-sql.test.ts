import { describe, expect, it } from "vitest";

import { createRuntimeSql } from "./runtime-sql.js";

describe("runtime SQL transport", () => {
  it("pins certificate and hostname verification for hosted Postgres", async () => {
    const sql = createRuntimeSql(
      "postgresql://app.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
      "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----\n",
    );

    expect(sql.options.ssl).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----\n",
      rejectUnauthorized: true,
    });
    await sql.end({ timeout: 0 });
  });

  it("keeps the fixed local acceptance database on loopback without TLS", async () => {
    const sql = createRuntimeSql("postgresql://acceptance:acceptance@127.0.0.1:5432/postgres");

    expect(sql.options.ssl).toBe(false);
    await sql.end({ timeout: 0 });
  });
});
