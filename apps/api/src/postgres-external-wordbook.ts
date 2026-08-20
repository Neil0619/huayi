import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { ExternalWordbookRepository } from "./external-wordbook-module.js";
import { applyExternalWordbookExportReceipts } from "./postgres-external-wordbook-export.js";
import { applyEudicImportPage } from "./postgres-external-wordbook-import.js";
import {
  externalWordbookInstant,
  loadCurrentExternalWordbookLease,
  lockExternalWordbookJob,
} from "./postgres-external-wordbook-lease.js";
import {
  listExternalJobs,
  loadExternalJob,
  replayWordbookWrite,
  saveWordbookWrite,
  translateExternalWordbookError,
} from "./postgres-external-wordbook-support.js";

async function finishWrite(
  trusted: AnalysisQuery,
  input: {
    key: string;
    now: string;
    operation: "wordbook.cancel" | "wordbook.create" | "wordbook.receipt" | "wordbook.retry";
    ownerUserId: string;
    requestHash: string;
  },
  response: Awaited<ReturnType<typeof loadExternalJob>>,
) {
  if (response === null) throw new CloudFault("not_found", "Wordbook job not found.");
  await saveWordbookWrite(trusted, { ...input, response });
  return response;
}

export function createPostgresExternalWordbook(
  database: AnalysisDatabase,
): ExternalWordbookRepository {
  return {
    async cancel(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const operation = "wordbook.cancel" as const;
          const replay = await replayWordbookWrite(
            trusted,
            command.ownerUserId,
            operation,
            command.idempotencyKey,
            command.requestHash,
          );
          if (replay !== null) return replay;
          const job = await lockExternalWordbookJob(tenant, command.jobId);
          if (job.revision !== command.expectedRevision) {
            throw new CloudFault("revision_conflict", "Wordbook job revision changed.");
          }
          if (job.state !== "active" && job.state !== "failed" && job.state !== "pending") {
            throw new CloudFault("wordbook_job_not_claimable", "Wordbook job cannot be cancelled.");
          }
          await tenant.rows(
            `UPDATE external_wordbook_items SET state='cancelled',stable_error_code=NULL,
               updated_at=$2 WHERE job_id=$1 AND state IN ('pending','failed')`,
            [command.jobId, command.now],
          );
          const inFlight = await tenant.rows<{ count: number }>(
            "SELECT count(*)::int count FROM external_wordbook_items WHERE job_id=$1 AND state='in-flight'",
            [command.jobId],
          );
          const keepLease =
            job.direction === "import" && job.state === "active" && job.lease_nonce_hash !== null
              ? 1
              : (inFlight[0]?.count ?? 0);
          await tenant.rows(
            `UPDATE external_wordbook_jobs SET state='cancelled',last_error_code=NULL,
               lease_nonce_hash=CASE WHEN $2::int>0 THEN lease_nonce_hash ELSE NULL END,
               lease_expires_at=CASE WHEN $2::int>0 THEN lease_expires_at ELSE NULL END,
               revision=revision+1,updated_at=$3 WHERE id=$1`,
            [command.jobId, keepLease, command.now],
          );
          return finishWrite(
            trusted,
            {
              key: command.idempotencyKey,
              now: command.now,
              operation,
              ownerUserId: command.ownerUserId,
              requestHash: command.requestHash,
            },
            await loadExternalJob(tenant, command.jobId),
          );
        });
      } catch (error) {
        return translateExternalWordbookError(error);
      }
    },
    async create(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const operation = "wordbook.create" as const;
          const replay = await replayWordbookWrite(
            trusted,
            command.ownerUserId,
            operation,
            command.idempotencyKey,
            command.requestHash,
          );
          if (replay !== null) return replay;
          await tenant.rows("SELECT pg_advisory_xact_lock(hashtextextended($1,7))", [
            `${command.ownerUserId}:${command.request.target}:${command.request.direction}`,
          ]);
          const open = await tenant.rows<{ id: string }>(
            `SELECT id::text FROM external_wordbook_jobs
             WHERE target=$1 AND direction=$2 AND state IN ('pending','active','failed') FOR UPDATE`,
            [command.request.target, command.request.direction],
          );
          let jobId = open[0]?.id;
          if (jobId === undefined) {
            jobId = command.jobId;
            await tenant.rows(
              `INSERT INTO external_wordbook_jobs(
                 id,owner_user_id,target,direction,state,next_page,created_at,updated_at
               ) VALUES($1,$2,$3,$4,'pending',$5,$6,$6)`,
              [
                jobId,
                command.ownerUserId,
                command.request.target,
                command.request.direction,
                command.request.direction === "import" ? 0 : null,
                command.now,
              ],
            );
            if (command.request.direction === "export") {
              await tenant.rows(
                `INSERT INTO external_wordbook_items(
                   id,owner_user_id,job_id,word_entry_id,payload_snapshot,state,created_at,updated_at
                 ) SELECT md5($1::text||':'||words.id::text)::uuid,$2::uuid,$1::uuid,words.id,
                   jsonb_strip_nulls(jsonb_build_object(
                     'headword',words.headword,
                     'contextLine',CASE WHEN $3::text='eudic' THEN contexts.source_text ELSE NULL END
                   )),'pending',$4,$4
                 FROM word_entries words
                 LEFT JOIN LATERAL (
                   SELECT source_text FROM context_observations
                   WHERE word_entry_id=words.id AND source_text IS NOT NULL
                   ORDER BY observed_at DESC,id DESC LIMIT 1
                 ) contexts ON true`,
                [jobId, command.ownerUserId, command.request.target, command.now],
              );
              const count = await tenant.rows<{ count: number }>(
                "SELECT count(*)::int count FROM external_wordbook_items WHERE job_id=$1",
                [jobId],
              );
              if ((count[0]?.count ?? 0) === 0) {
                await tenant.rows(
                  "UPDATE external_wordbook_jobs SET state='completed',updated_at=$2 WHERE id=$1",
                  [jobId, command.now],
                );
              }
            }
          }
          return finishWrite(
            trusted,
            {
              key: command.idempotencyKey,
              now: command.now,
              operation,
              ownerUserId: command.ownerUserId,
              requestHash: command.requestHash,
            },
            await loadExternalJob(tenant, jobId),
          );
        });
      } catch (error) {
        return translateExternalWordbookError(error);
      }
    },
    findById(ownerUserId, jobId) {
      return database.transaction(ownerUserId, ({ tenant }) => loadExternalJob(tenant, jobId));
    },
    async lease(command) {
      return database.transaction(command.ownerUserId, async ({ tenant }) => {
        const job = await lockExternalWordbookJob(tenant, command.jobId);
        if (
          job.state === "active" &&
          job.lease_nonce_hash === command.nonceHash &&
          job.lease_expires_at !== null
        ) {
          return loadCurrentExternalWordbookLease(
            tenant,
            job,
            externalWordbookInstant(job.lease_expires_at),
          );
        }
        if (job.state !== "pending" && job.state !== "active") {
          throw new CloudFault("wordbook_job_not_claimable", "Wordbook job cannot be leased.");
        }
        if (
          job.lease_nonce_hash !== null &&
          job.lease_expires_at !== null &&
          Date.parse(externalWordbookInstant(job.lease_expires_at)) > Date.parse(command.now)
        ) {
          throw new CloudFault("wordbook_job_leased", "Wordbook job already has an active lease.");
        }
        if (job.revision !== command.expectedRevision) {
          throw new CloudFault("revision_conflict", "Wordbook job revision changed.");
        }
        if (job.direction === "export") {
          await tenant.rows(
            `UPDATE external_wordbook_items SET state='pending',updated_at=$2
             WHERE job_id=$1 AND state='in-flight'`,
            [command.jobId, command.now],
          );
          const pending = await tenant.rows<{ id: string }>(
            `SELECT id::text FROM external_wordbook_items WHERE job_id=$1 AND state='pending'
             ORDER BY created_at,id LIMIT 20`,
            [command.jobId],
          );
          if (pending.length === 0) {
            throw new CloudFault("wordbook_job_not_claimable", "The export has no pending items.");
          }
          for (const item of pending) {
            await tenant.rows(
              `UPDATE external_wordbook_items SET state='in-flight',attempt_count=attempt_count+1,
                 updated_at=$2 WHERE id=$1`,
              [item.id, command.now],
            );
          }
        }
        await tenant.rows(
          `UPDATE external_wordbook_jobs SET state='active',lease_nonce_hash=$2,
             lease_expires_at=$3,revision=revision+1,updated_at=$4 WHERE id=$1`,
          [command.jobId, command.nonceHash, command.newExpiresAt, command.now],
        );
        return loadCurrentExternalWordbookLease(
          tenant,
          { ...job, lease_expires_at: new Date(command.newExpiresAt), state: "active" },
          command.newExpiresAt,
        );
      });
    },
    list(ownerUserId, query) {
      return database.transaction(ownerUserId, ({ tenant }) => listExternalJobs(tenant, query));
    },
    async retry(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const operation = "wordbook.retry" as const;
          const replay = await replayWordbookWrite(
            trusted,
            command.ownerUserId,
            operation,
            command.idempotencyKey,
            command.requestHash,
          );
          if (replay !== null) return replay;
          const job = await lockExternalWordbookJob(tenant, command.jobId);
          if (job.revision !== command.expectedRevision) {
            throw new CloudFault("revision_conflict", "Wordbook job revision changed.");
          }
          if (job.state !== "failed") {
            throw new CloudFault("wordbook_job_not_claimable", "Only a failed job can be retried.");
          }
          await tenant.rows(
            `UPDATE external_wordbook_items SET state='pending',stable_error_code=NULL,updated_at=$2
             WHERE job_id=$1 AND state='failed'`,
            [command.jobId, command.now],
          );
          await tenant.rows(
            `UPDATE external_wordbook_jobs SET state='pending',last_error_code=NULL,
               lease_nonce_hash=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=$2
             WHERE id=$1`,
            [command.jobId, command.now],
          );
          return finishWrite(
            trusted,
            {
              key: command.idempotencyKey,
              now: command.now,
              operation,
              ownerUserId: command.ownerUserId,
              requestHash: command.requestHash,
            },
            await loadExternalJob(tenant, command.jobId),
          );
        });
      } catch (error) {
        return translateExternalWordbookError(error);
      }
    },
    async submit(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const operation = "wordbook.receipt" as const;
          const replay = await replayWordbookWrite(
            trusted,
            command.ownerUserId,
            operation,
            command.idempotencyKey,
            command.requestHash,
          );
          if (replay !== null) return replay;
          const job = await lockExternalWordbookJob(tenant, command.jobId);
          if (
            job.lease_nonce_hash !== command.nonceHash ||
            job.lease_expires_at === null ||
            externalWordbookInstant(job.lease_expires_at) !== command.tokenExpiresAt
          ) {
            throw new CloudFault("wordbook_lease_stale", "Wordbook lease is no longer current.");
          }
          if (job.state === "cancelled" && command.request.kind !== "export") {
            await tenant.rows(
              `UPDATE external_wordbook_jobs SET lease_nonce_hash=NULL,lease_expires_at=NULL,
                 revision=revision+1,updated_at=$2 WHERE id=$1`,
              [command.jobId, command.now],
            );
          } else if (command.request.kind === "eudic-import-failure") {
            if (job.direction !== "import" || command.request.page !== job.next_page) {
              throw new CloudFault("wordbook_lease_stale", "Import page does not match the lease.");
            }
            await tenant.rows(
              `UPDATE external_wordbook_jobs SET state='failed',last_error_code=$2,
                 lease_nonce_hash=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=$3
               WHERE id=$1`,
              [command.jobId, command.request.stableErrorCode, command.now],
            );
          } else if (command.request.kind === "eudic-import-page") {
            if (job.direction !== "import" || command.request.page !== job.next_page) {
              throw new CloudFault("wordbook_lease_stale", "Import page does not match the lease.");
            }
            await applyEudicImportPage(tenant, {
              entries: command.importEntries ?? [],
              jobId: command.jobId,
              now: command.now,
              ownerUserId: command.ownerUserId,
              page: command.request.page,
            });
          } else {
            if (job.direction !== "export") {
              throw new CloudFault("wordbook_lease_stale", "Export receipts do not match the job.");
            }
            await applyExternalWordbookExportReceipts(tenant, {
              jobId: command.jobId,
              jobState: job.state,
              now: command.now,
              request: command.request,
              target: job.target,
            });
          }
          return finishWrite(
            trusted,
            {
              key: command.idempotencyKey,
              now: command.now,
              operation,
              ownerUserId: command.ownerUserId,
              requestHash: command.requestHash,
            },
            await loadExternalJob(tenant, command.jobId),
          );
        });
      } catch (error) {
        return translateExternalWordbookError(error);
      }
    },
  };
}
