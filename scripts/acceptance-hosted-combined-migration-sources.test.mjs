import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadHostedCombinedMigrationRebuildSources } from "./acceptance-hosted-combined-migration-rebuild.mjs";

test("combined rebuild rejects source drift even when both mirrors change together", async () => {
  const root = await mkdtemp(join(tmpdir(), "seen-said-combined-sources-"));
  try {
    await mkdir(join(root, "supabase"), { recursive: true });
    await cp("supabase/migrations", join(root, "supabase/migrations"), { recursive: true });
    await cp("supabase/seed.sql", join(root, "supabase/seed.sql"));
    await cp("apps/api/migrations", join(root, "apps/api/migrations"), { recursive: true });
    const mirror = join(root, "supabase/migrations/20260907020000_error_diagnostics.sql");
    const source = `${await readFile(mirror, "utf8")}\n-- unreviewed drift\n`;
    await writeFile(mirror, source);
    await writeFile(join(root, "apps/api/migrations/0027-error-diagnostics.sql"), source);
    await assert.rejects(loadHostedCombinedMigrationRebuildSources(root), /sources are invalid/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
