import { createHash } from "node:crypto";

import {
  accountDataExportRecordReadSchema,
  accountDataExportRecordV3Schema,
  projectAccountDataExportRecordForV2,
  projectAccountDataExportRecordForLegacy,
  dataRightsWorkerResponseSchema,
  type AccountDataExportRecordRead,
  type AccountDataExportFormatVersion,
} from "@huayi/cloud-contracts";

export interface ExportClaim {
  formatVersion: AccountDataExportFormatVersion;
  exportId: string;
  leaseToken: string;
  objectKey: string;
  ownerUserId: string;
}
export interface DeletionClaim {
  deleteAuthUser: boolean;
  exportObjectKeys: string[];
  jobId: string;
  leaseToken: string;
  stage: "database-deleted" | "exports-deleted" | "requested";
  subjectUserId: string;
}
export interface AccountDataRightsWorkerRepository {
  claimExportCandidateCleanup?(): Promise<string | null>;
  finishExportCandidateCleanup?(objectKey: string): Promise<void>;
  prepareExportUpload(claim: ExportClaim): Promise<void>;
  reconcileExportPublication(command: {
    exportId: string;
    leaseToken: string;
    objectKey: string;
    byteLength: number;
    recordCount: number;
    sha256: string;
  }): Promise<"published" | "retired">;
  cleanupExpiredExport?(): Promise<{ exportId: string; objectKey: string } | null>;
  claimDeletion(): Promise<DeletionClaim | null>;
  claimExport(): Promise<ExportClaim | null>;
  completeExport(command: {
    byteLength: number;
    expiresAt: string;
    exportId: string;
    leaseToken: string;
    objectKey: string;
    recordCount: number;
    sha256: string;
  }): Promise<boolean>;
  failDeletion(command: {
    errorCode: "auth-delete-failed" | "database-delete-failed" | "object-delete-failed";
    jobId: string;
    leaseToken: string;
  }): Promise<void>;
  failExport(command: {
    errorCode: "export-build-failed" | "object-write-failed";
    exportId: string;
    leaseToken: string;
  }): Promise<void>;
  finishExpiredExportCleanup?(command: { exportId: string; objectKey: string }): Promise<void>;
  failExpiredExportCleanup?(command: { exportId: string; objectKey: string }): Promise<void>;
  finishAuthDeletion(command: { jobId: string; leaseToken: string }): Promise<void>;
  finishDatabaseDeletion(command: { jobId: string; leaseToken: string }): Promise<void>;
  finishExportDeletion(command: { jobId: string; leaseToken: string }): Promise<void>;
}

export function createAccountDataRightsWorker(options: {
  authority: {
    deleteAuthUser(userId: string): Promise<void>;
    deleteObjects(keys: string[]): Promise<void>;
    upload(objectKey: string, content: Uint8Array): Promise<void>;
  };
  exportSource: {
    records(
      ownerUserId: string,
      snapshotAt: string,
      formatVersion?: AccountDataExportFormatVersion,
    ): Promise<AccountDataExportRecordRead[]>;
  };
  now(): Date;
  repository: AccountDataRightsWorkerRepository;
}) {
  const processExport = async (): Promise<"idle" | "processed" | "failed"> => {
    const cleanup = await options.repository.cleanupExpiredExport?.();
    if (cleanup !== undefined && cleanup !== null) {
      try {
        await options.authority.deleteObjects([cleanup.objectKey]);
        await options.repository.finishExpiredExportCleanup?.(cleanup);
        return "processed";
      } catch {
        await options.repository.failExpiredExportCleanup?.(cleanup);
        return "failed";
      }
    }
    const retired = await options.repository.claimExportCandidateCleanup?.();
    if (retired) {
      await options.authority.deleteObjects([retired]);
      await options.repository.finishExportCandidateCleanup?.(retired);
    }
    const claim = await options.repository.claimExport();
    if (claim === null) return retired ? "processed" : "idle";
    const exportedAt = options.now();
    let records: AccountDataExportRecordRead[];
    try {
      records = [
        accountDataExportRecordReadSchema.parse({
          exportedAt: exportedAt.toISOString(),
          product: "huayi-cloud",
          recordType: "manifest",
          schemaVersion: claim.formatVersion,
        }),
        ...(
          await options.exportSource.records(
            claim.ownerUserId,
            exportedAt.toISOString(),
            claim.formatVersion,
          )
        ).map((value) => {
          const record = accountDataExportRecordReadSchema.parse(value);
          if (record.recordType === "manifest") throw new Error("Unexpected export manifest.");
          return claim.formatVersion === 1
            ? projectAccountDataExportRecordForLegacy(record)
            : claim.formatVersion === 2
              ? projectAccountDataExportRecordForV2(record)
              : accountDataExportRecordV3Schema.parse(record);
        }),
      ];
    } catch {
      await options.repository.failExport({
        errorCode: "export-build-failed",
        exportId: claim.exportId,
        leaseToken: claim.leaseToken,
      });
      return "failed";
    }
    const body = new TextEncoder().encode(
      records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
    const publication = {
      byteLength: body.byteLength,
      exportId: claim.exportId,
      leaseToken: claim.leaseToken,
      objectKey: claim.objectKey,
      recordCount: records.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    try {
      await options.repository.prepareExportUpload(claim);
      await options.authority.upload(claim.objectKey, body);
      const readyAt = options.now();
      const published = await options.repository.completeExport({
        ...publication,
        expiresAt: new Date(readyAt.getTime() + 24 * 60 * 60_000).toISOString(),
      });
      if (!published) throw new Error("Export publication was not confirmed.");
      return "processed";
    } catch {
      // A lost reply can follow a committed publication. Reconcile and retire atomically;
      // only the separately fenced, durable cleanup path may delete candidate objects.
      return (await options.repository.reconcileExportPublication(publication)) === "published"
        ? "processed"
        : "failed";
    }
  };

  const processDeletion = async (): Promise<"idle" | "processed" | "failed"> => {
    const claim = await options.repository.claimDeletion();
    if (claim === null) return "idle";
    let stage = claim.stage;
    try {
      if (stage === "requested") {
        await options.authority.deleteObjects(claim.exportObjectKeys);
        await options.repository.finishExportDeletion(claim);
        stage = "exports-deleted";
      }
      if (stage === "exports-deleted") {
        await options.repository.finishDatabaseDeletion(claim);
        stage = "database-deleted";
      }
      if (claim.deleteAuthUser) await options.authority.deleteAuthUser(claim.subjectUserId);
      await options.repository.finishAuthDeletion(claim);
      return "processed";
    } catch {
      const errorCode =
        stage === "requested"
          ? "object-delete-failed"
          : stage === "exports-deleted"
            ? "database-delete-failed"
            : "auth-delete-failed";
      await options.repository.failDeletion({
        errorCode,
        jobId: claim.jobId,
        leaseToken: claim.leaseToken,
      });
      return "failed";
    }
  };

  return {
    async runOne() {
      return dataRightsWorkerResponseSchema.parse({
        deletion: await processDeletion(),
        export: await processExport(),
      });
    },
  };
}

export type AccountDataRightsWorker = ReturnType<typeof createAccountDataRightsWorker>;
