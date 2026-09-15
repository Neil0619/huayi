import { createHash, randomUUID } from "node:crypto";
import {
  shanbayBackfillCommandSchema,
  shanbayBackfillResponseSchema,
  type ShanbayBackfillCommand,
  type ShanbayBackfillResponse,
} from "@huayi/cloud-contracts";
import {
  adoptBackfill,
  backfillStatus,
  claimBackfillBatch,
  discoverBackfill,
  discardBackfillSource,
  expireBackfillBatches,
  findBackfillLemma,
  markBackfillUnknown,
  renewBackfillBatch,
  replaceBackfillSource,
  resolveBackfillBatch,
  retryBackfillUnknown,
  type BackfillState,
} from "@huayi/cloud-contracts";
import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import { synchronizeLegacyBackfill } from "./postgres-shanbay-legacy.js";
import {
  lockBackfillAccount,
  loadBackfillState,
  saveBackfillState,
  type BackfillAccountRow,
} from "./postgres-shanbay-backfill-state.js";

function status(account: BackfillAccountRow, state: BackfillState) {
  return {
    ...backfillStatus(state),
    enabled: account.enabled,
    dailyHour: account.daily_hour,
    revision: account.revision,
    scopeId: account.scope_id,
    lastCheckedAt: account.last_checked_at?.toISOString() ?? null,
  };
}

async function reconcile(
  query: AnalysisQuery,
  state: BackfillState,
  cursor: string | null,
  now: string,
) {
  const rows = await query.rows<{ id: string; headword: string }>(
    "SELECT id::text,headword FROM word_entries WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT 101",
    [cursor],
  );
  const page = rows.slice(0, 100);
  discoverBackfill(
    state,
    page.map((row) => row.headword),
    "cloud",
    now,
  );
  return rows.length > 100 ? (page.at(-1)?.id ?? null) : null;
}

function apply(
  state: BackfillState,
  account: BackfillAccountRow,
  holder: string,
  command: ShanbayBackfillCommand,
  now: string,
): Pick<ShanbayBackfillResponse, "accepted" | "batch"> {
  if ("expectedRevision" in command && command.expectedRevision !== account.revision)
    throw new CloudFault("revision_conflict", "Backfill revision changed.");
  switch (command.action) {
    case "settings":
      account.enabled = command.enabled;
      account.daily_hour = command.dailyHour;
      return { accepted: true, batch: null };
    case "discover":
      if (command.origin === "cloud")
        throw new CloudFault("invalid_request", "Cloud words must be reconciled by the server.");
      discoverBackfill(state, command.headwords, command.origin, now);
      break;
    case "adopt":
      adoptBackfill(state, command.sources, command.confirmed, now);
      if (command.unknown?.length) {
        const blocked = new Set(
          state.batches
            .filter((batch) => batch.state !== "resolved")
            .flatMap((batch) => batch.headwords),
        );
        const words = [...new Set(command.unknown)].filter(
          (word) => !blocked.has(word) && state.targets[word]?.confirmedAt == null,
        );
        for (let index = 0; index < words.length; index += 20)
          state.batches.push({
            token: randomUUID(),
            holder,
            headwords: words.slice(index, index + 20),
            state: "unknown",
            expiresAt: now,
          });
      }
      break;
    case "claim": {
      const batch = claimBackfillBatch(state, { holder, now, token: randomUUID() });
      return {
        accepted: true,
        batch: batch
          ? { token: batch.token, headwords: batch.headwords, expiresAt: batch.expiresAt }
          : null,
      };
    }
    case "renew": {
      const accepted = renewBackfillBatch(state, { holder, now, token: command.token });
      const batch = accepted ? state.batches.find((value) => value.token === command.token) : null;
      return {
        accepted,
        batch: batch
          ? { token: batch.token, headwords: batch.headwords, expiresAt: batch.expiresAt }
          : null,
      };
    }
    case "resolve":
      return {
        accepted: resolveBackfillBatch(state, {
          ...command,
          holder,
          now,
          findLemma: findBackfillLemma,
        }),
        batch: null,
      };
    case "unknown": {
      const batch = state.batches.find(
        (value) =>
          value.token === command.token && value.holder === holder && value.state === "prepared",
      );
      if (batch) markBackfillUnknown(state, command.token, now);
      return { accepted: !!batch, batch: null };
    }
    case "retry-unknown":
      return { accepted: retryBackfillUnknown(state, command.token, now), batch: null };
    case "replace":
      return {
        accepted: replaceBackfillSource(state, command.source, command.target, now),
        batch: null,
      };
    case "discard":
      return { accepted: discardBackfillSource(state, command.source, now), batch: null };
    case "reconcile":
      break;
  }
  return { accepted: true, batch: null };
}

export function createPostgresShanbayBackfill(database: AnalysisDatabase) {
  return {
    async status(owner: string) {
      return database.transaction(owner, async ({ tenant }) => {
        const account = await lockBackfillAccount(tenant, owner);
        const state = await loadBackfillState(tenant);
        const before = structuredClone(state);
        await synchronizeLegacyBackfill(tenant, state, new Date().toISOString());
        expireBackfillBatches(state, new Date().toISOString());
        await saveBackfillState(tenant, owner, before, state);
        return status(account, state);
      });
    },
    async unresolved(owner: string, cursor?: string) {
      return database.transaction(owner, async ({ tenant }) => {
        const account = await lockBackfillAccount(tenant, owner);
        const state = await loadBackfillState(tenant);
        const all = [
          ...Object.values(state.sources)
            .filter((source) => source.state === "unresolved")
            .map((source) => ({ key: `s:${source.headword}`, source })),
          ...state.batches
            .filter((batch) => batch.state === "unknown")
            .map((batch) => ({
              ...batch,
              headwords: batch.headwords.filter((word) => state.targets[word]?.confirmedAt == null),
            }))
            .filter((batch) => batch.headwords.length > 0)
            .map((batch) => ({ key: `b:${batch.token}`, batch })),
        ]
          .sort((a, b) => (a.key < b.key ? -1 : 1))
          .filter((item) => cursor === undefined || item.key > cursor);
        const page = all.slice(0, 100);
        return {
          items: page.flatMap((item) => ("source" in item ? [item.source] : [])),
          unknownBatches: page.flatMap((item) =>
            "batch" in item ? [{ token: item.batch.token, headwords: item.batch.headwords }] : [],
          ),
          nextCursor: all.length > 100 ? (page.at(-1)?.key ?? null) : null,
          revision: account.revision,
        };
      });
    },
    async execute(
      owner: string,
      holder: string,
      key: string,
      input: ShanbayBackfillCommand,
    ): Promise<ShanbayBackfillResponse> {
      const command = shanbayBackfillCommandSchema.parse(input);
      const now = new Date().toISOString();
      const hash = createHash("sha256").update(JSON.stringify({ holder, command })).digest("hex");
      try {
        return await database.transaction(owner, async ({ tenant, trusted }) => {
          const [replay] = await trusted.rows<{ response: unknown }>(
            "SELECT begin_backfill_write($1,$2,$3) AS response",
            [owner, key, hash],
          );
          if (replay?.response != null) return shanbayBackfillResponseSchema.parse(replay.response);
          const account = await lockBackfillAccount(tenant, owner);
          if (
            !account.enabled &&
            ["claim", "discover", "reconcile", "adopt"].includes(command.action)
          )
            throw new CloudFault(
              "forbidden",
              "Enable backfill before discovering or claiming words.",
            );
          const state = await loadBackfillState(tenant);
          const before = structuredClone(state);
          await synchronizeLegacyBackfill(tenant, state, now);
          expireBackfillBatches(state, now);
          let nextCursor: string | null = null;
          if (command.action === "reconcile") {
            nextCursor = await reconcile(tenant, state, command.cursor, now);
            if (nextCursor === null) account.last_checked_at = new Date(now);
          }
          const result = apply(state, account, holder, command, now);
          await synchronizeLegacyBackfill(tenant, state, now);
          account.revision += 1;
          await saveBackfillState(tenant, owner, before, state);
          await tenant.rows(
            "UPDATE shanbay_backfill_accounts SET enabled=$2,daily_hour=$3,revision=$4,last_checked_at=$5 WHERE owner_user_id=$1",
            [owner, account.enabled, account.daily_hour, account.revision, account.last_checked_at],
          );
          const response = shanbayBackfillResponseSchema.parse({
            ...result,
            status: status(account, state),
            nextCursor,
          });
          await tenant.rows(
            "INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at) VALUES($1,'shanbay-backfill',$2,$3,$4::jsonb,$5)",
            [
              owner,
              key,
              hash,
              JSON.stringify(response),
              new Date(Date.parse(now) + 7 * 86_400_000).toISOString(),
            ],
          );
          return response;
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("idempotency conflict"))
          throw new CloudFault("idempotency_conflict", "Backfill request key was already used.");
        throw error;
      }
    },
  };
}
