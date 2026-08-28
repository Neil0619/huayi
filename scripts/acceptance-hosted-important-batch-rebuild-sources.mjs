import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  assertHostedImportantBatchArtifactContract,
  hostedPhase81ArtifactContract,
} from "./acceptance-hosted-important-batch-contracts.mjs";

const seedSha256 = "c9281f541e21f7c59c90bec11f19a0a03ffdf05789ed547bdc9fbc855c2bd6ef";
const migrationFilePattern = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/u;

async function assertRegularBoundedFile(path, maximumBytes) {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.size < 1 || stats.size > maximumBytes) {
    throw new Error("Hosted important-batch rebuild source is invalid.");
  }
}

async function assertHistoricalMigrationPrefix(migrationsRoot, actualFiles, artifactContract) {
  const frozenFiles = artifactContract.migrationFiles;
  if (
    actualFiles.length < frozenFiles.length ||
    frozenFiles.some((file, index) => actualFiles[index] !== file)
  ) {
    throw new Error("Hosted important-batch migration source set is invalid.");
  }

  let previousVersion = artifactContract.rebuildMigrationHead;
  for (const file of actualFiles.slice(frozenFiles.length)) {
    const match = migrationFilePattern.exec(file);
    const version = match?.[1];
    if (version === undefined || version <= previousVersion) {
      throw new Error("Hosted important-batch migration source set is invalid.");
    }
    previousVersion = version;
  }

  try {
    await Promise.all(
      actualFiles.map((file) => assertRegularBoundedFile(join(migrationsRoot, file), 1_048_576)),
    );
  } catch {
    throw new Error("Hosted important-batch migration source set is invalid.");
  }
}

export async function loadHostedImportantBatchRebuildSources(
  repositoryRoot,
  artifactContract = hostedPhase81ArtifactContract,
) {
  assertHostedImportantBatchArtifactContract(artifactContract);
  const migrationsRoot = join(repositoryRoot, "supabase", "migrations");
  const actualFiles = (await readdir(migrationsRoot)).sort();
  await assertHistoricalMigrationPrefix(migrationsRoot, actualFiles, artifactContract);
  const migrations = [];
  for (const [index, file] of artifactContract.migrationFiles.entries()) {
    const path = join(migrationsRoot, file);
    migrations.push({
      source: await readFile(path, "utf8"),
      version: artifactContract.migrationVersions[index],
    });
  }
  const seedPath = join(repositoryRoot, "supabase", "seed.sql");
  await assertRegularBoundedFile(seedPath, 65_536);
  const seed = await readFile(seedPath, "utf8");
  if (createHash("sha256").update(seed).digest("hex") !== seedSha256) {
    throw new Error("Hosted important-batch fictional seed is invalid.");
  }
  return { migrations, seed };
}

export function assertHostedImportantBatchRebuildSources(sources, artifactContract) {
  if (
    sources === null ||
    typeof sources !== "object" ||
    !Array.isArray(sources.migrations) ||
    sources.migrations.length !== artifactContract.migrationVersions.length ||
    typeof sources.seed !== "string" ||
    sources.seed.length === 0
  ) {
    throw new Error("Hosted important-batch rebuild sources are invalid.");
  }
  for (const [index, migration] of sources.migrations.entries()) {
    if (
      migration?.version !== artifactContract.migrationVersions[index] ||
      typeof migration.source !== "string" ||
      migration.source.length === 0
    ) {
      throw new Error("Hosted important-batch rebuild sources are invalid.");
    }
  }
}
