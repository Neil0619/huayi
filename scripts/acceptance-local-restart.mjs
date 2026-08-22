import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runPersistentDev } from "./acceptance-local-dev-lifecycle.mjs";
import { verifyAcceptanceRuntime } from "./acceptance-local-runtime.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeEntrypoint = resolve(repositoryRoot, "scripts/acceptance-local-runtime.mjs");
const databaseContainer = "supabase_db_seen-and-said-local-acceptance";

const fixedRelations = new Set([
  "auth.identities",
  "auth.users",
  "storage.buckets",
  "storage.objects",
  "supabase_migrations.schema_migrations",
]);
const requiredRelations = new Set([
  ...fixedRelations,
  "public.invitations",
  "public.learning_items",
  "public.user_profiles",
  "public.word_entries",
]);

export const PERSISTENCE_SNAPSHOT_SQL = String.raw`
BEGIN;
CREATE TEMP TABLE acceptance_persistence_snapshot (
  relation_name text PRIMARY KEY,
  row_count bigint NOT NULL,
  row_digest text NOT NULL
) ON COMMIT DROP;

DO $acceptance_snapshot$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT relations.schemaname, relations.tablename
    FROM (
      SELECT tables.schemaname, tables.tablename
      FROM pg_catalog.pg_tables AS tables
      WHERE tables.schemaname = 'public'
      UNION ALL
      SELECT fixed.schemaname, fixed.tablename
      FROM (VALUES
        ('auth', 'users'),
        ('auth', 'identities'),
        ('storage', 'buckets'),
        ('storage', 'objects'),
        ('supabase_migrations', 'schema_migrations')
      ) AS fixed(schemaname, tablename)
    ) AS relations
    ORDER BY relations.schemaname, relations.tablename
  LOOP
    EXECUTE format(
      $snapshot_query$
        INSERT INTO acceptance_persistence_snapshot (
          relation_name,
          row_count,
          row_digest
        )
        SELECT
          %L,
          count(*),
          encode(
            sha256(
              convert_to(
                COALESCE(string_agg(row_digest, '' ORDER BY row_digest), ''),
                'UTF8'
              )
            ),
            'hex'
          )
        FROM (
          SELECT encode(
            sha256(convert_to(to_jsonb(snapshot_row)::text, 'UTF8')),
            'hex'
          ) AS row_digest
          FROM %I.%I AS snapshot_row
        ) AS row_digests
      $snapshot_query$,
      target.schemaname || '.' || target.tablename,
      target.schemaname,
      target.tablename
    );
  END LOOP;
END;
$acceptance_snapshot$;

COPY (
  SELECT relation_name, row_count, row_digest
  FROM acceptance_persistence_snapshot
  ORDER BY relation_name
) TO STDOUT WITH (FORMAT text, DELIMITER '|');
ROLLBACK;
`;

function runCommand(command, arguments_, { capture = false } = {}) {
  return new Promise((resolveResult) => {
    let stdout = "";
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", capture ? "pipe" : "ignore", "ignore"],
      windowsHide: true,
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < 131_072) stdout += chunk;
    });
    child.once("error", () => resolveResult({ code: null, stdout: "" }));
    child.once("exit", (code, signal) =>
      resolveResult({ code: signal === null ? code : null, stdout }),
    );
  });
}

function allowedRelation(relation) {
  return /^public\.[a-z][a-z0-9_]*$/u.test(relation) || fixedRelations.has(relation);
}

export function parsePersistenceSnapshot(output) {
  const lines = output.trim().split(/\r?\n/u);
  if (lines.length === 0 || lines[0] === "") return null;
  const entries = new Map();
  for (const line of lines) {
    const match = /^([^|]+)\|(0|[1-9]\d*)\|([a-f0-9]{64})$/u.exec(line);
    if (match === null) return null;
    const [, relation, count, digest] = match;
    if (!allowedRelation(relation) || entries.has(relation)) return null;
    entries.set(relation, `${relation}|${count}|${digest}`);
  }
  if ([...requiredRelations].some((relation) => !entries.has(relation))) return null;
  return [...entries.values()].sort().join("\n");
}

export async function snapshotAcceptanceDatabase({ run = runCommand } = {}) {
  const result = await run(
    "docker",
    [
      "exec",
      "-i",
      databaseContainer,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-c",
      PERSISTENCE_SNAPSHOT_SQL,
    ],
    { capture: true },
  );
  return result.code === 0 ? parsePersistenceSnapshot(result.stdout) : null;
}

async function runRuntimeAction(action, run = runCommand) {
  const result = await run(process.execPath, [runtimeEntrypoint, action]);
  return result.code === 0;
}

function snapshotsMatch(before, after) {
  const beforeBuffer = Buffer.from(before, "utf8");
  const afterBuffer = Buffer.from(after, "utf8");
  return beforeBuffer.length === afterBuffer.length && timingSafeEqual(beforeBuffer, afterBuffer);
}

export async function verifyRestartPersistence({
  arguments_ = [],
  migrateRuntime = () => runRuntimeAction("migrate"),
  snapshot = () => snapshotAcceptanceDatabase(),
  startDev = () => runPersistentDev("start"),
  startRuntime = () => runRuntimeAction("start"),
  stopDev = () => runPersistentDev("stop"),
  stopRuntime = () => runRuntimeAction("stop"),
  verifyRuntime = verifyAcceptanceRuntime,
} = {}) {
  if (arguments_.length !== 0) return "invalid-arguments";
  try {
    if (!(await verifyRuntime())) return "failed";
    const before = await snapshot();
    if (before === null) return "failed";
    if (!(await stopDev())) return "failed";
    if (!(await stopRuntime())) return "failed";
    if (!(await startRuntime())) return "failed";
    if (!(await migrateRuntime())) return "failed";
    if (!(await verifyRuntime())) return "failed";
    const after = await snapshot();
    if (after === null) return "failed";
    if (!snapshotsMatch(before, after)) return "mismatch";
    if (!(await startDev())) return "failed";
    return "succeeded";
  } catch {
    return "failed";
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRestartPersistence({ arguments_: process.argv.slice(2) })
    .then((result) => {
      if (result === "succeeded") {
        process.stdout.write("Local acceptance persistence verification completed.\n");
        return;
      }
      process.stderr.write(
        result === "invalid-arguments"
          ? "Local acceptance persistence verification does not accept arguments.\n"
          : "Local acceptance persistence verification failed. Check local service status before retrying.\n",
      );
      process.exitCode = 1;
    })
    .catch(() => {
      process.stderr.write(
        "Local acceptance persistence verification failed. Check local service status before retrying.\n",
      );
      process.exitCode = 1;
    });
}
