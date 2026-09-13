import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadHostedCombinedMigrationRebuildSources } from "./acceptance-hosted-combined-migration-rebuild.mjs";
import { hostedCombinedMigrationSourcePins } from "./acceptance-hosted-combined-migration-sources.mjs";
import { createHostedCombinedMigrationSourceFixture } from "./acceptance-hosted-combined-migration-test-support.mjs";

const directories = [
  ["supabase/migrations", "mirrorFile"],
  ["apps/api/migrations", "apiFile"],
];

async function validFixture(context) {
  const root = await createHostedCombinedMigrationSourceFixture(context);
  const sources = await loadHostedCombinedMigrationRebuildSources(root);
  assert.equal(sources.migrations.length, 28);
  assert.equal(sources.migrations.at(-1).version, "20260907030000");
  return root;
}

test("combined historical fixture contains exactly the 28 pinned regular files in each mirror", async (context) => {
  const root = await validFixture(context);
  assert.equal(hostedCombinedMigrationSourcePins.length, 28);
  for (const [directory, key] of directories) {
    assert.deepEqual(
      (await readdir(join(root, directory))).sort(),
      hostedCombinedMigrationSourcePins.map((pin) => pin[key]).sort(),
    );
    for (const pin of hostedCombinedMigrationSourcePins) {
      const path = join(root, directory, pin[key]);
      assert.ok((await lstat(path)).isFile());
      assert.equal(
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
        pin.sha256,
      );
    }
  }
  assert.equal(
    createHash("sha256")
      .update(await readFile(join(root, "supabase/seed.sql")))
      .digest("hex"),
    "c9281f541e21f7c59c90bec11f19a0a03ffdf05789ed547bdc9fbc855c2bd6ef",
  );
});

test("combined rebuild rejects source drift even when both mirrors change together", async (context) => {
  const root = await validFixture(context);
  const mirror = join(root, "supabase/migrations/20260907020000_error_diagnostics.sql");
  const source = `${await readFile(mirror, "utf8")}\n-- unreviewed drift\n`;
  await writeFile(mirror, source);
  await writeFile(join(root, "apps/api/migrations/0027-error-diagnostics.sql"), source);
  await assert.rejects(loadHostedCombinedMigrationRebuildSources(root), /sources are invalid/u);
});

for (const [directory, key] of directories) {
  test(`combined rebuild rejects an additional migration in ${directory}`, async (context) => {
    const root = await validFixture(context);
    const extra = key === "mirrorFile" ? "20990101000000_unreviewed.sql" : "9999-unreviewed.sql";
    await writeFile(join(root, directory, extra), "SELECT 1;\n");
    await assert.rejects(loadHostedCombinedMigrationRebuildSources(root), /source set is invalid/u);
  });

  for (const mutation of ["missing", "directory", "hash"]) {
    test(`combined rebuild rejects ${mutation} drift in ${directory}`, async (context) => {
      const root = await validFixture(context);
      const path = join(root, directory, hostedCombinedMigrationSourcePins.at(-1)[key]);
      if (mutation === "hash") await writeFile(path, "SELECT 1;\n");
      else {
        await rm(path);
        if (mutation === "directory") await mkdir(path);
      }
      await assert.rejects(
        loadHostedCombinedMigrationRebuildSources(root),
        /(?:source set|sources|mirror) (?:is|are) invalid/u,
      );
    });
  }
}

test("combined rebuild rejects fictional seed drift", async (context) => {
  const root = await validFixture(context);
  await writeFile(join(root, "supabase/seed.sql"), "SELECT 1;\n");
  await assert.rejects(
    loadHostedCombinedMigrationRebuildSources(root),
    /fictional seed is invalid/u,
  );
});
