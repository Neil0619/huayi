import { captureHostedImportantBatchBackup } from "./acceptance-hosted-important-batch-capture.mjs";
import { hostedCombinedMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { runHostedImportantBatchProcess } from "./acceptance-hosted-important-batch-execution-contract.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { persistHostedCombinedMigrationBackup } from "./acceptance-hosted-combined-migration-artifacts.mjs";
import { loadHostedCombinedMigrationSources } from "./acceptance-hosted-combined-migration-sources.mjs";
import { renderHostedCombinedMigrationCaptureSql } from "./acceptance-hosted-combined-migration-sql.mjs";

export const hostedCombinedMigrationCapturePreArgument = `--confirm-capture-pre-0026-0027-0028-backup-${hostedAcceptanceProjectRef}`;
export const hostedCombinedMigrationCapturePostArgument = `--confirm-capture-post-0026-0027-0028-backup-${hostedAcceptanceProjectRef}`;

const sharedCaptureSql = `/* hosted_important_batch_capture_contract */
SELECT 'migration_head|' || COALESCE(max(version), '')
FROM supabase_migrations.schema_migrations;
SELECT 'storage_objects_zero|' || CASE WHEN count(*) = 0 THEN 't' ELSE 'f' END
FROM storage.objects;
`;

export async function captureHostedCombinedMigrationBackup(options) {
  const sources = await (
    options.loadSources ?? (() => loadHostedCombinedMigrationSources(options.repositoryRoot))
  )();
  const sql = renderHostedCombinedMigrationCaptureSql(options.phase, sources);
  const runProcess = options.runProcess ?? runHostedImportantBatchProcess;
  let contractChecked = false;
  await captureHostedImportantBatchBackup({
    ...options,
    artifactContract: hostedCombinedMigrationArtifactContract,
    persistBackup: options.persistBackup ?? persistHostedCombinedMigrationBackup,
    runProcess: async (command, arguments_, processOptions) => {
      const entrypoint = arguments_.indexOf("--entrypoint");
      if (entrypoint >= 0 && arguments_[entrypoint + 1] === "psql") {
        const sqlIndex = arguments_.indexOf("--command") + 1;
        if (contractChecked || arguments_[sqlIndex] !== sharedCaptureSql)
          throw new Error("Combined capture contract drifted.");
        contractChecked = true;
        const fixedArguments = [...arguments_];
        fixedArguments[sqlIndex] = sql;
        return runProcess(command, fixedArguments, processOptions);
      }
      if (entrypoint >= 0 && arguments_[entrypoint + 1] === "pg_dump" && !contractChecked) {
        throw new Error("Combined capture contract was not checked.");
      }
      const result = await runProcess(command, arguments_, processOptions);
      if (entrypoint >= 0 && arguments_[entrypoint + 1] === "pg_restore" && result.code === 0) {
        const tables = [
          "learning_tasks",
          "learning_task_submission_keys",
          "learning_task_events",
          "practice_sessions",
        ];
        if (options.phase === "post") tables.push("error_diagnostics");
        const lines = result.stdout.split(/\r?\n/u);
        if (
          tables.some(
            (table) =>
              !lines.some((line) =>
                new RegExp(`^\\d+;\\s+\\d+\\s+\\d+\\s+TABLE DATA public ${table} \\S+$`, "u").test(
                  line,
                ),
              ),
          )
        ) {
          // A completed process with insufficient TOC coverage is a validation failure,
          // not an uncertain Docker process. Empty coverage makes the shared verifier
          // reject it after its normal identity cleanup, without a false late-start wait.
          return { ...result, stdout: "" };
        }
      }
      return result;
    },
  });
}
