import { hashSecret, opaqueSecret, type Clock, type SecretSource } from "./security.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import type {
  AccountDataRightsWorkerRepository,
  DeletionClaim,
  ExportClaim,
} from "./account-data-rights-worker.js";

function requireResult(value: boolean | null | undefined): void {
  if (value !== true) throw new Error("Account data-rights lease is stale.");
}

export function createPostgresAccountDataRightsWorker(
  database: AnalysisDatabase,
  options: { clock: Clock; pepper: string; secrets: SecretSource },
): AccountDataRightsWorkerRepository {
  const lease = () => {
    const token = opaqueSecret(options.secrets);
    return {
      expiresAt: new Date(options.clock.now().getTime() + 120_000),
      hash: hashSecret(token, options.pepper),
      token,
    };
  };
  const advance = async (claim: { jobId: string; leaseToken: string }, from: string, to: string) =>
    database.trusted(async (query) => {
      const result = (
        await query.rows<{ advanced: boolean | null }>(
          "SELECT advance_account_deletion($1,$2,$3,$4) advanced",
          [claim.jobId, hashSecret(claim.leaseToken, options.pepper), from, to],
        )
      )[0]?.advanced;
      requireResult(result);
    });
  return {
    async cleanupExpiredExport() {
      return database.trusted(async (query) => {
        const row = (
          await query.rows<{ id: string; object_key: string }>(
            "SELECT id::text,object_key FROM claim_expired_account_export()",
          )
        )[0];
        return row === undefined ? null : { exportId: row.id, objectKey: row.object_key };
      });
    },
    async claimDeletion(): Promise<DeletionClaim | null> {
      const proof = lease();
      return database.trusted(async (query) => {
        const row = (
          await query.rows<{
            job_id: string;
            object_keys: string[];
            stage: DeletionClaim["stage"];
            subject_user_id: string;
          }>("SELECT * FROM claim_account_deletion($1,$2)", [proof.hash, proof.expiresAt])
        )[0];
        return row === undefined
          ? null
          : {
              exportObjectKeys: row.object_keys,
              jobId: row.job_id,
              leaseToken: proof.token,
              stage: row.stage,
              subjectUserId: row.subject_user_id,
            };
      });
    },
    async claimExport(): Promise<ExportClaim | null> {
      const proof = lease();
      return database.trusted(async (query) => {
        const row = (
          await query.rows<{ id: string; owner_user_id: string }>(
            "SELECT id::text,owner_user_id::text FROM claim_account_export($1,$2)",
            [proof.hash, proof.expiresAt],
          )
        )[0];
        return row === undefined
          ? null
          : {
              exportId: row.id,
              leaseToken: proof.token,
              objectKey: `account-exports/${row.id}.ndjson`,
              ownerUserId: row.owner_user_id,
            };
      });
    },
    async completeExport(command) {
      return database.trusted(async (query) => {
        const result = (
          await query.rows<{ completed: boolean | null }>(
            "SELECT complete_account_export($1,$2,$3,$4,$5,$6,$7) completed",
            [
              command.exportId,
              hashSecret(command.leaseToken, options.pepper),
              command.recordCount,
              command.byteLength,
              command.sha256,
              command.objectKey,
              command.expiresAt,
            ],
          )
        )[0]?.completed;
        requireResult(result);
        return true;
      });
    },
    async failDeletion(command) {
      return database.trusted(async (query) => {
        const result = (
          await query.rows<{ failed: boolean | null }>(
            "SELECT fail_account_deletion($1,$2,$3) failed",
            [command.jobId, hashSecret(command.leaseToken, options.pepper), command.errorCode],
          )
        )[0]?.failed;
        requireResult(result);
      });
    },
    async failExport(command) {
      return database.trusted(async (query) => {
        const result = (
          await query.rows<{ failed: boolean | null }>(
            "SELECT fail_account_export($1,$2,$3) failed",
            [command.exportId, hashSecret(command.leaseToken, options.pepper), command.errorCode],
          )
        )[0]?.failed;
        requireResult(result);
      });
    },
    async failExpiredExportCleanup(command) {
      return database.trusted(async (query) => {
        const result = (
          await query.rows<{ failed: boolean | null }>(
            "SELECT fail_expired_account_export_cleanup($1,$2) failed",
            [command.exportId, command.objectKey],
          )
        )[0]?.failed;
        requireResult(result);
      });
    },
    async finishAuthDeletion(command) {
      return database.trusted(async (query) => {
        const result = (
          await query.rows<{ completed: boolean | null }>(
            "SELECT complete_account_deletion($1,$2) completed",
            [command.jobId, hashSecret(command.leaseToken, options.pepper)],
          )
        )[0]?.completed;
        requireResult(result);
      });
    },
    async finishExpiredExportCleanup(command) {
      return database.trusted(async (query) => {
        const result = (
          await query.rows<{ completed: boolean | null }>(
            "SELECT finish_expired_account_export_cleanup($1,$2) completed",
            [command.exportId, command.objectKey],
          )
        )[0]?.completed;
        requireResult(result);
      });
    },
    finishDatabaseDeletion: (claim) => advance(claim, "exports-deleted", "database-deleted"),
    finishExportDeletion: (claim) => advance(claim, "requested", "exports-deleted"),
  };
}
