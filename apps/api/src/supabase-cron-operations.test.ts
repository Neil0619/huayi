import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const operationsUrl = new URL("../operations/configure-supabase-cron.sql", import.meta.url);

const jobs = [
  ["huayi-password-recovery", "/internal/password-recovery/run"],
  ["huayi-data-rights", "/internal/data-rights/run"],
  ["huayi-extension-query-cleanup", "/internal/extension-queries/cleanup"],
  ["huayi-duplicate-suggestion-cleanup", "/internal/learning-duplicate-suggestions/cleanup"],
] as const;

describe("Supabase Cron production adapter", () => {
  it("installs four independent minute jobs through one private allowlisted adapter", async () => {
    const sql = await readFile(operationsUrl, "utf8");

    expect(sql).toMatch(/create extension if not exists pg_cron/iu);
    expect(sql).toMatch(/create extension if not exists pg_net[\s\S]*schema extensions/iu);
    expect(sql).toMatch(/create extension if not exists supabase_vault[\s\S]*schema vault/iu);
    expect(sql).toContain("vault.decrypted_secrets");
    expect(sql).toContain("huayi_api_origin");
    expect(sql).toContain("huayi_cron_secret");
    expect(sql).toMatch(/authorization[\s\S]*bearer/iu);
    expect(sql).toMatch(/accept[\s\S]*application\/json/iu);
    expect(sql).toMatch(/timeout_milliseconds\s*:=\s*55_000/iu);
    expect(sql).toMatch(/security definer[\s\S]*set search_path = pg_catalog, net, vault/iu);
    expect(sql).toMatch(/unsupported cron path/iu);
    expect(sql).toMatch(/revoke all on function huayi_private\.[^(]+\(text\) from public/iu);
    expect(sql).toMatch(/revoke all on function huayi_private\.[^(]+\(text\) from anon/iu);
    expect(sql).toMatch(/cron\.unschedule/iu);
    expect(sql.match(/cron\.schedule\(/gu)).toHaveLength(jobs.length);

    for (const [jobName, path] of jobs) {
      expect(sql).toContain(`'${jobName}'`);
      expect(sql).toContain(`'${path}'`);
    }
    expect(sql.match(/'\* \* \* \* \*'/gu)).toHaveLength(jobs.length);
  });

  it("fails closed on missing deployment configuration without embedding credentials", async () => {
    const sql = await readFile(operationsUrl, "utf8");

    expect(sql).toMatch(/api_origin is null/iu);
    expect(sql).toMatch(/cron_secret is null/iu);
    expect(sql).toMatch(/api_origin not like 'https:\/\/%'/iu);
    expect(sql).toMatch(/length\(cron_secret\) < 32/iu);
    expect(sql).toMatch(/length\(cron_secret\) > 512/iu);
    expect(sql).not.toContain("seen-said");
    expect(sql).not.toMatch(/bearer [a-z0-9_-]{32,}/iu);
  });
});
