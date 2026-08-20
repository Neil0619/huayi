import { createHash } from "node:crypto";

import {
  accountDataExportJobResourceSchema,
  accountDeletionRequestSchema,
  accountDeletionResponseSchema,
  createAccountDataExportRequestSchema,
  downloadAccountDataExportResponseSchema,
  retryAccountDataExportRequestSchema,
  type AccountDataExportJobResource,
} from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";

interface ExportWriteCommand {
  idempotencyKey: string;
  ownerUserId: string;
  requestHash: string;
}
interface ExportRetryCommand extends ExportWriteCommand {
  expectedRevision: number;
  exportId: string;
}
interface DeletionCommand extends ExportWriteCommand {
  confirmation: "delete-account";
  requestedAt: string;
  requestSessionHash: string;
}

export interface AccountDataRightsRepository {
  currentExport(ownerUserId: string): Promise<AccountDataExportJobResource | null>;
  exportDownload(
    ownerUserId: string,
    exportId: string,
  ): Promise<{ expiresAt: string; objectKey: string } | null>;
  requestDeletion(command: DeletionCommand): Promise<{ accepted: true; requestedAt: string }>;
  replayDeletion(command: {
    idempotencyKey: string;
    requestHash: string;
    requestSessionHash: string;
  }): Promise<{ accepted: true; requestedAt: string } | null>;
  requestExport(command: ExportWriteCommand): Promise<AccountDataExportJobResource>;
  retryExport(command: ExportRetryCommand): Promise<AccountDataExportJobResource>;
}

export interface AccountDataSignedUrls {
  create(objectKey: string, validForSeconds: number): Promise<{ url: string }>;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireRecentAuthentication(now: Date, reauthenticatedAt: Date): void {
  const age = now.getTime() - reauthenticatedAt.getTime();
  if (age < 0 || age > 15 * 60_000) {
    throw new CloudFault("forbidden", "Recent authentication is required.");
  }
}

export function createAccountDataRightsModule(options: {
  now(): Date;
  repository: AccountDataRightsRepository;
  signedUrls: AccountDataSignedUrls;
}) {
  return {
    async createDownload(ownerUserId: string, exportId: string, reauthenticatedAt: Date) {
      const now = options.now();
      requireRecentAuthentication(now, reauthenticatedAt);
      const target = await options.repository.exportDownload(ownerUserId, exportId);
      if (target === null) throw new CloudFault("not_found", "Export not found.");
      const remainingSeconds = Math.floor(
        (new Date(target.expiresAt).getTime() - now.getTime()) / 1_000,
      );
      if (remainingSeconds < 60) {
        throw new CloudFault("revision_conflict", "The export is no longer downloadable.");
      }
      const validForSeconds = Math.min(900, remainingSeconds);
      const signed = await options.signedUrls.create(target.objectKey, validForSeconds);
      return downloadAccountDataExportResponseSchema.parse({
        expiresAt: new Date(now.getTime() + validForSeconds * 1_000).toISOString(),
        url: signed.url,
      });
    },
    async currentExport(ownerUserId: string) {
      const current = await options.repository.currentExport(ownerUserId);
      return current === null ? null : accountDataExportJobResourceSchema.parse(current);
    },
    async requestDeletion(
      ownerUserId: string,
      idempotencyKey: string,
      requestSessionHash: string,
      reauthenticatedAt: Date,
      input: unknown,
    ) {
      const request = accountDeletionRequestSchema.parse(input);
      const now = options.now();
      requireRecentAuthentication(now, reauthenticatedAt);
      return accountDeletionResponseSchema.parse(
        await options.repository.requestDeletion({
          confirmation: request.confirmation,
          idempotencyKey,
          ownerUserId,
          requestedAt: now.toISOString(),
          requestHash: digest({ operation: "account.delete", request }),
          requestSessionHash,
        }),
      );
    },
    async replayDeletion(idempotencyKey: string, requestSessionHash: string, input: unknown) {
      const request = accountDeletionRequestSchema.parse(input);
      const replay = await options.repository.replayDeletion({
        idempotencyKey,
        requestHash: digest({ operation: "account.delete", request }),
        requestSessionHash,
      });
      return replay === null ? null : accountDeletionResponseSchema.parse(replay);
    },
    async requestExport(ownerUserId: string, idempotencyKey: string, input: unknown) {
      const request = createAccountDataExportRequestSchema.parse(input);
      return accountDataExportJobResourceSchema.parse(
        await options.repository.requestExport({
          idempotencyKey,
          ownerUserId,
          requestHash: digest({ operation: "account-export.create", request }),
        }),
      );
    },
    async retryExport(
      ownerUserId: string,
      exportId: string,
      idempotencyKey: string,
      input: unknown,
    ) {
      const request = retryAccountDataExportRequestSchema.parse(input);
      return accountDataExportJobResourceSchema.parse(
        await options.repository.retryExport({
          expectedRevision: request.expectedRevision,
          exportId,
          idempotencyKey,
          ownerUserId,
          requestHash: digest({ exportId, operation: "account-export.retry", request }),
        }),
      );
    },
  };
}

export type AccountDataRightsModule = ReturnType<typeof createAccountDataRightsModule>;
