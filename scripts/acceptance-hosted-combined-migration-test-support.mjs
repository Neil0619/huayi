import assert from "node:assert/strict";
import { copyFile, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostedCombinedMigrationSourcePins } from "./acceptance-hosted-combined-migration-sources.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

// The historical live gate requires exactly 28 migrations, even as the repo grows.
// Copy only its reviewed inputs; never alter or link the evolving source directories.
export async function createHostedCombinedMigrationSourceFixture(context) {
  const root = await mkdtemp(join(tmpdir(), "seen-said-combined-sources-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const files = [
    "supabase/seed.sql",
    ...hostedCombinedMigrationSourcePins.flatMap((pin) => [
      `supabase/migrations/${pin.mirrorFile}`,
      `apps/api/migrations/${pin.apiFile}`,
    ]),
  ];
  for (const file of files) {
    const source = join(repositoryRoot, file);
    assert.ok((await lstat(source)).isFile(), `Fixture source must be a regular file: ${file}`);
    const destination = join(root, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  return root;
}
