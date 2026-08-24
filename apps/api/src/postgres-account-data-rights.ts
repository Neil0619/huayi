import { createHmac } from "node:crypto";

import {
  accountDataExportJobResourceSchema,
  accountDeletionResponseSchema,
  type AccountDataExportJobResource,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import type { AccountDataRightsRepository } from "./account-data-rights-module.js";
import { CloudFault } from "./cloud-fault.js";

interface ExportRow {
  byte_length: number | string | null;
  created_at: Date | string;
  expires_at: Date | string | null;
  format_version: number;
  id: string;
  last_error_code: string | null;
  object_key: string | null;
  record_count: number | null;
  revision: number;
  state: AccountDataExportJobResource["state"];
  updated_at: Date | string;
}

function instant(value: Date | string): string {
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

function databaseInteger(value: number | string | null): number | null {
  if (typeof value !== "string") return value;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new Error("Invalid database integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Database integer exceeds safe range.");
  return parsed;
}

export function projectAccountDataExportRow(row: ExportRow): AccountDataExportJobResource {
  const common = {
    createdAt: instant(row.created_at),
    formatVersion: row.format_version,
    id: row.id,
    revision: row.revision,
    updatedAt: instant(row.updated_at),
  };
  if (row.state === "ready") {
    return accountDataExportJobResourceSchema.parse({
      ...common,
      byteLength: databaseInteger(row.byte_length),
      expiresAt: row.expires_at === null ? null : instant(row.expires_at),
      recordCount: row.record_count,
      state: row.state,
    });
  }
  if (row.state === "failed") {
    return accountDataExportJobResourceSchema.parse({
      ...common,
      stableErrorCode: row.last_error_code,
      state: row.state,
    });
  }
  if (row.state === "expired") {
    return accountDataExportJobResourceSchema.parse({
      ...common,
      expiresAt: row.expires_at === null ? row.updated_at : row.expires_at,
      state: row.state,
    });
  }
  return accountDataExportJobResourceSchema.parse({ ...common, state: row.state });
}

const exportColumns = `id::text,state,format_version,record_count,byte_length,object_key,
  expires_at,last_error_code,revision,created_at,updated_at`;

async function replay(
  trusted: AnalysisQuery,
  ownerUserId: string,
  operation: string,
  key: string,
  requestHash: string,
) {
  return (
    await trusted.rows<{ response: unknown }>(
      "SELECT begin_idempotent_write($1,$2,$3,$4) AS response",
      [ownerUserId, operation, key, requestHash],
    )
  )[0]?.response;
}

async function save(
  tenant: AnalysisQuery,
  command: { idempotencyKey: string; ownerUserId: string; requestHash: string },
  operation: string,
  response: unknown,
) {
  await tenant.rows(
    `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
     VALUES($1,$2,$3,$4,$5::jsonb,now()+interval '7 days')`,
    [
      command.ownerUserId,
      operation,
      command.idempotencyKey,
      command.requestHash,
      JSON.stringify(response),
    ],
  );
}

function translate(error: unknown): never {
  if (error instanceof CloudFault) throw error;
  if (error instanceof Error && error.message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key is already in use.");
  }
  throw error;
}

export function createPostgresAccountDataRights(
  database: AnalysisDatabase,
  options: { id(): string; pepper: string },
): AccountDataRightsRepository {
  const protect = (purpose: string, value: string) =>
    createHmac("sha256", options.pepper).update(`${purpose}:${value}`).digest("hex");
  return {
    async currentExport(ownerUserId) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        const row = (
          await tenant.rows<ExportRow>(
            `SELECT ${exportColumns} FROM account_data_export_jobs
             ORDER BY created_at DESC,id DESC LIMIT 1`,
          )
        )[0];
        return row === undefined ? null : projectAccountDataExportRow(row);
      });
    },
    async exportDownload(ownerUserId, exportId) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        const row = (
          await tenant.rows<{ expires_at: Date | string; object_key: string }>(
            `SELECT object_key,expires_at FROM account_data_export_jobs
             WHERE id=$1 AND state='ready' AND expires_at>now()`,
            [exportId],
          )
        )[0];
        return row === undefined
          ? null
          : { expiresAt: instant(row.expires_at), objectKey: row.object_key };
      });
    },
    async requestDeletion(command) {
      try {
        return await database.trusted(async (trusted) => {
          const row = (
            await trusted.rows<{ requested_at: Date | string | null }>(
              `SELECT request_account_deletion($1,$2,$3,$4,$5,$6,$7,$8) requested_at`,
              [
                options.id(),
                command.ownerUserId,
                protect("subject", command.ownerUserId),
                protect("deletion-key", command.idempotencyKey),
                command.requestHash,
                command.requestSessionHash,
                command.requestedAt,
                new Date(Date.parse(command.requestedAt) + 24 * 60 * 60_000).toISOString(),
              ],
            )
          )[0];
          if (row?.requested_at === null || row?.requested_at === undefined) {
            throw new CloudFault("not_found", "Account not found.");
          }
          return accountDeletionResponseSchema.parse({
            accepted: true,
            requestedAt: instant(row.requested_at),
          });
        });
      } catch (error) {
        return translate(error);
      }
    },
    async replayDeletion(command) {
      return database.trusted(async (trusted) => {
        const row = (
          await trusted.rows<{ requested_at: Date | string | null }>(
            "SELECT replay_account_deletion($1,$2,$3) requested_at",
            [
              protect("deletion-key", command.idempotencyKey),
              command.requestHash,
              command.requestSessionHash,
            ],
          )
        )[0];
        return row?.requested_at === null || row?.requested_at === undefined
          ? null
          : accountDeletionResponseSchema.parse({
              accepted: true,
              requestedAt: instant(row.requested_at),
            });
      });
    },
    async requestExport(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const operation = "account-export.create";
          const previous = await replay(
            trusted,
            command.ownerUserId,
            operation,
            command.idempotencyKey,
            command.requestHash,
          );
          if (previous !== null && previous !== undefined) {
            return accountDataExportJobResourceSchema.parse(previous);
          }
          await tenant.rows("SELECT pg_advisory_xact_lock(hashtextextended($1,13))", [
            command.ownerUserId,
          ]);
          let row = (
            await tenant.rows<ExportRow>(
              `SELECT ${exportColumns} FROM account_data_export_jobs
               WHERE state IN ('pending','running','ready') FOR UPDATE`,
            )
          )[0];
          if (row === undefined) {
            row = (
              await tenant.rows<ExportRow>(
                `INSERT INTO account_data_export_jobs(id,owner_user_id,state)
                 VALUES($1,$2,'pending') RETURNING ${exportColumns}`,
                [options.id(), command.ownerUserId],
              )
            )[0];
          }
          if (row === undefined) throw new Error("Export insert returned no row.");
          const response = projectAccountDataExportRow(row);
          await save(tenant, command, operation, response);
          return response;
        });
      } catch (error) {
        return translate(error);
      }
    },
    async retryExport(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const operation = "account-export.retry";
          const previous = await replay(
            trusted,
            command.ownerUserId,
            operation,
            command.idempotencyKey,
            command.requestHash,
          );
          if (previous !== null && previous !== undefined) {
            return accountDataExportJobResourceSchema.parse(previous);
          }
          const existing = (
            await tenant.rows<ExportRow>(
              `SELECT ${exportColumns} FROM account_data_export_jobs WHERE id=$1 FOR UPDATE`,
              [command.exportId],
            )
          )[0];
          if (existing === undefined) throw new CloudFault("not_found", "Export not found.");
          if (existing.revision !== command.expectedRevision) {
            throw new CloudFault("revision_conflict", "Export revision changed.");
          }
          if (existing.state !== "failed") {
            throw new CloudFault("revision_conflict", "Only failed exports can be retried.");
          }
          const row = (
            await tenant.rows<ExportRow>(
              `UPDATE account_data_export_jobs SET state='pending',last_error_code=NULL,
                 revision=revision+1,updated_at=now() WHERE id=$1 RETURNING ${exportColumns}`,
              [command.exportId],
            )
          )[0];
          if (row === undefined) throw new Error("Export retry returned no row.");
          const response = projectAccountDataExportRow(row);
          await save(tenant, command, operation, response);
          return response;
        });
      } catch (error) {
        return translate(error);
      }
    },
  };
}
