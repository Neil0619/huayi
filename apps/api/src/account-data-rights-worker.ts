import { createHash } from "node:crypto";

import {
  accountDataExportRecordSchema,
  dataRightsWorkerResponseSchema,
  type AccountDataExportRecord,
} from "@huayi/cloud-contracts";

export interface ExportClaim {
  exportId: string;
  leaseToken: string;
  objectKey: string;
  ownerUserId: string;
}
export interface DeletionClaim {
  exportObjectKeys: string[];
  jobId: string;
  leaseToken: string;
  stage: "database-deleted" | "exports-deleted" | "requested";
  subjectUserId: string;
}
export interface AccountDataRightsWorkerRepository {
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
    records(ownerUserId: string, snapshotAt: string): Promise<AccountDataExportRecord[]>;
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
    const claim = await options.repository.claimExport();
    if (claim === null) return "idle";
    const exportedAt = options.now();
    let records: AccountDataExportRecord[];
    try {
      records = [
        accountDataExportRecordSchema.parse({
          exportedAt: exportedAt.toISOString(),
          product: "huayi-cloud",
          recordType: "manifest",
          schemaVersion: 1,
        }),
        ...(await options.exportSource.records(claim.ownerUserId, exportedAt.toISOString())).map(
          (record) => accountDataExportRecordSchema.parse(record),
        ),
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
    try {
      await options.authority.upload(claim.objectKey, body);
      const readyAt = options.now();
      await options.repository.completeExport({
        byteLength: body.byteLength,
        expiresAt: new Date(readyAt.getTime() + 24 * 60 * 60_000).toISOString(),
        exportId: claim.exportId,
        leaseToken: claim.leaseToken,
        objectKey: claim.objectKey,
        recordCount: records.length,
        sha256: createHash("sha256").update(body).digest("hex"),
      });
      return "processed";
    } catch {
      await options.authority.deleteObjects([claim.objectKey]).catch(() => undefined);
      await options.repository.failExport({
        errorCode: "object-write-failed",
        exportId: claim.exportId,
        leaseToken: claim.leaseToken,
      });
      return "failed";
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
      await options.authority.deleteAuthUser(claim.subjectUserId);
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
