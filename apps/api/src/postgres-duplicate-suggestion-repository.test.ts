import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import type {
  BeginDuplicateSuggestionGenerationCommand,
  CompleteDuplicateSuggestionGenerationCommand,
} from "./paid-duplicate-suggestion-generator.js";
import { createPostgresDuplicateSuggestionMaintenance } from "./postgres-duplicate-suggestion-maintenance.js";
import { createPostgresDuplicateSuggestionRepository } from "./postgres-duplicate-suggestion-repository.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const sourceId = "60000000-0000-0000-0000-00000000000a";
const candidateId = "60000000-0000-0000-0000-00000000000b";
const priceId = "80000000-0000-0000-0000-000000000001";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

function command(overrides: Partial<BeginDuplicateSuggestionGenerationCommand> = {}) {
  return {
    candidateAliases: [{ alias: "candidate-1", itemId: candidateId, itemRevision: 1 }],
    idempotencyKey: "duplicate-key",
    leaseToken: "lease-1",
    now: "2026-08-14T02:00:00.000Z",
    ownerUserId: userA,
    requestHash: "a".repeat(64),
    requestId: "70000000-0000-0000-0000-000000000001",
    reservedMicroUsd: 1_000,
    sourceItemId: sourceId,
    sourceRevision: 1,
    ...overrides,
  } satisfies BeginDuplicateSuggestionGenerationCommand;
}

describe("Postgres duplicate suggestion repository", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  let nextOrdinal: number;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    adapter = {
      async transaction(ownerUserId, operation) {
        return database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          await transaction.query("SELECT huayi_private.set_owner_context($1)", [ownerUserId]);
          return operation({ tenant: query(transaction), trusted: query(transaction) });
        });
      },
      async trusted(operation) {
        return operation(query(database));
      },
    };
    nextOrdinal = 0;
    await database.exec(`INSERT INTO user_profiles(
      user_id,owner_user_id,email,status,timezone,daily_goal
    ) VALUES
      ('${userA}','${userA}','a@example.test','active','UTC',5),
      ('${userB}','${userB}','b@example.test','active','UTC',5);
    INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content,revision)
    VALUES
      ('${sourceId}','${userA}','expression','source',
        '{"type":"expression","text":"source","meaningZh":"来源","usageZh":"来源。"}',1),
      ('${candidateId}','${userA}','expression','candidate',
        '{"type":"expression","text":"candidate","meaningZh":"候选","usageZh":"候选。"}',1),
      ('60000000-0000-0000-0000-00000000000c','${userB}','expression','private',
        '{"type":"expression","text":"private","meaningZh":"私有","usageZh":"私有。"}',1);
    INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,
      cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from)
    VALUES('${priceId}','deepseek','deepseek-v4-flash',2,1,3,now());
    INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source)
    VALUES
      ('90000000-0000-0000-0000-00000000000a','${userA}','${userA}',
        date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',
        1000000,'default'),
      ('90000000-0000-0000-0000-00000000000b','${userB}','${userB}',
        date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
        (date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',
        1000000,'default');`);
  });

  afterEach(async () => database.close());

  function repository() {
    return createPostgresDuplicateSuggestionRepository({
      database: adapter,
      ledgerId: () => `a0000000-0000-4000-8000-${String(++nextOrdinal).padStart(12, "0")}`,
      prices: {
        cachedInputMicroUsdPerMillionTokens: 1,
        inputMicroUsdPerMillionTokens: 2,
        outputMicroUsdPerMillionTokens: 3,
      },
      priceVersionId: priceId,
      providerModel: "deepseek-v4-flash",
      reservationId: () => `b0000000-0000-4000-8000-${String(++nextOrdinal).padStart(12, "0")}`,
    });
  }

  function maintenance(now: string) {
    let ledgerOrdinal = 0;
    return createPostgresDuplicateSuggestionMaintenance({
      database: adapter,
      ledgerId: () => `c0000000-0000-4000-8000-${String(++ledgerOrdinal).padStart(12, "0")}`,
      now: () => new Date(now),
    });
  }

  it("enforces owner/key/hash, one active lease, fencing, and resolved replay", async () => {
    const store = repository();
    const first = await store.begin(command());
    expect(first).toMatchObject({ kind: "acquired" });
    if (first.kind !== "acquired") throw new Error("Reservation was not acquired.");

    await expect(
      store.begin(
        command({
          leaseToken: "other-lease",
          requestId: "70000000-0000-0000-0000-000000000002",
        }),
      ),
    ).resolves.toEqual({ kind: "busy" });
    await expect(store.begin(command({ requestHash: "b".repeat(64) }))).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
    await expect(
      store.markDispatched({
        ...command(),
        leaseToken: "wrong",
        reservationId: first.reservationId,
      }),
    ).resolves.toBe(false);
    await expect(
      store.markDispatched({ ...command(), reservationId: first.reservationId }),
    ).resolves.toBe(true);

    const response = { itemRevision: 1, suggestions: [] };
    const completed = await store.complete({
      ...command(),
      billedCalls: [
        {
          costMicroUsd: 17,
          usage: { cachedInputTokens: 2, inputTokens: 10, outputTokens: 4 },
        },
      ],
      reservationId: first.reservationId,
      response,
    } satisfies CompleteDuplicateSuggestionGenerationCommand);
    expect(completed).toEqual(response);
    await expect(
      store.begin(
        command({
          leaseToken: "replay-lease",
          requestId: "70000000-0000-0000-0000-000000000003",
        }),
      ),
    ).resolves.toEqual({ kind: "resolved", response });

    const settled = await database.query<{
      cost_micro_usd: string;
      expires_within_day: boolean;
      feature: string;
      status: string;
    }>(`SELECT ledger.feature,ledger.cost_micro_usd::text,reservations.status,
      requests.expires_at<=requests.created_at+interval '24 hours' expires_within_day
      FROM learning_duplicate_suggestion_requests requests
      JOIN quota_reservations reservations ON reservations.id=requests.reservation_id
      JOIN usage_ledger ledger ON ledger.request_id=requests.id`);
    expect(settled.rows).toEqual([
      {
        cost_micro_usd: "17",
        expires_within_day: true,
        feature: "learning-duplicate-suggestions",
        status: "settled",
      },
    ]);
  });

  it("releases and reclaims an expired pre-dispatch lease", async () => {
    const store = repository();
    const first = await store.begin(command());
    if (first.kind !== "acquired") throw new Error("Reservation was not acquired.");
    const replacement = command({
      leaseToken: "lease-2",
      now: "2026-08-14T02:03:00.000Z",
      requestId: "70000000-0000-0000-0000-000000000004",
    });
    const second = await store.begin(replacement);
    expect(second).toMatchObject({ kind: "acquired" });
    if (second.kind !== "acquired") throw new Error("Replacement was not acquired.");
    expect(second.reservationId).not.toBe(first.reservationId);
    await expect(
      store.markDispatched({ ...command(), reservationId: first.reservationId }),
    ).resolves.toBe(false);
    await expect(
      store.markDispatched({ ...replacement, reservationId: second.reservationId }),
    ).resolves.toBe(true);
    const reservations = await database.query<{ generation: number | null; status: string }>(
      `SELECT reservations.status,requests.generation FROM quota_reservations reservations
      LEFT JOIN learning_duplicate_suggestion_requests requests
        ON requests.reservation_id=reservations.id ORDER BY reservations.created_at,reservations.id`,
    );
    expect(reservations.rows).toEqual([
      { generation: null, status: "released" },
      { generation: 2, status: "active" },
    ]);
  });

  it("maintenance releases an expired undispatched request so the same key can acquire anew", async () => {
    const store = repository();
    const first = await store.begin(command());
    if (first.kind !== "acquired") throw new Error("Reservation was not acquired.");
    await database.exec(`INSERT INTO learning_duplicate_suggestion_requests(
      id,owner_user_id,source_item_id,source_revision,idempotency_key,request_hash,state,generation,
      lease_token,lease_expires_at,candidate_aliases,response,created_at,updated_at,expires_at
    ) SELECT md5('maintenance-terminal-'||value::text)::uuid,'${userA}','${sourceId}',1,
      'terminal-key-'||value::text,repeat('d',64),'completed',1,'terminal-lease',
      '2026-08-14T01:00:00Z',
      '[{"alias":"candidate-1","itemId":"${candidateId}","itemRevision":1}]',
      '{"itemRevision":1,"suggestions":[]}','2026-08-14T00:00:00Z',
      '2026-08-14T00:00:00Z','2026-08-14T01:00:00Z'
      FROM generate_series(1,100) value;`);

    await expect(maintenance("2026-08-14T02:03:00.000Z").runBatch()).resolves.toEqual({
      abandonedCount: 1,
      deletedCount: 99,
    });

    const replacement = command({
      leaseToken: "lease-after-maintenance",
      now: "2026-08-14T02:03:00.000Z",
      requestId: "70000000-0000-0000-0000-000000000006",
    });
    const second = await store.begin(replacement);
    expect(second).toMatchObject({ kind: "acquired" });
    if (second.kind !== "acquired") throw new Error("Replacement was not acquired.");
    expect(second.reservationId).not.toBe(first.reservationId);

    const durable = await database.query<{
      expired_terminal_count: number;
      ledger_count: number;
      reservation_statuses: string[];
      same_key_request_count: number;
    }>(`SELECT
      (SELECT count(*)::integer FROM learning_duplicate_suggestion_requests
        WHERE state IN ('completed','failed') AND expires_at<='2026-08-14T02:03:00.000Z')
        expired_terminal_count,
      (SELECT count(*)::integer FROM usage_ledger) ledger_count,
      (SELECT count(*)::integer FROM learning_duplicate_suggestion_requests
        WHERE idempotency_key='duplicate-key') same_key_request_count,
      array_agg(status ORDER BY created_at,id) reservation_statuses
      FROM quota_reservations`);
    expect(durable.rows).toEqual([
      {
        expired_terminal_count: 1,
        ledger_count: 0,
        reservation_statuses: ["released", "active"],
        same_key_request_count: 1,
      },
    ]);
    await expect(
      store.markDispatched({ ...command(), reservationId: first.reservationId }),
    ).resolves.toBe(false);
  });

  it("maintenance conservatively settles an expired dispatched lease and never reacquires its key", async () => {
    const store = repository();
    const first = await store.begin(command());
    if (first.kind !== "acquired") throw new Error("Reservation was not acquired.");
    await store.markDispatched({ ...command(), reservationId: first.reservationId });

    await expect(maintenance("2026-08-14T02:03:00.000Z").runBatch()).resolves.toEqual({
      abandonedCount: 1,
      deletedCount: 0,
    });

    const retry = command({
      leaseToken: "lease-2",
      now: "2026-08-14T02:03:00.000Z",
      requestId: "70000000-0000-0000-0000-000000000005",
    });
    await expect(store.begin(retry)).rejects.toMatchObject({ code: "model_unavailable" });
    await expect(store.begin(retry)).rejects.toMatchObject({ code: "model_unavailable" });
    const durable = await database.query<{
      cost_micro_usd: string;
      ledger_count: number;
      outcome: string;
      request_count: number;
      stable_error_code: string;
      state: string;
      status: string;
    }>(`SELECT requests.state,requests.stable_error_code,reservations.status,ledger.outcome,
      ledger.cost_micro_usd::text,
      (SELECT count(*)::integer FROM learning_duplicate_suggestion_requests) request_count,
      (SELECT count(*)::integer FROM usage_ledger) ledger_count
      FROM learning_duplicate_suggestion_requests requests
      JOIN quota_reservations reservations ON reservations.id=requests.reservation_id
      JOIN usage_ledger ledger ON ledger.request_id=requests.id`);
    expect(durable.rows).toEqual([
      {
        cost_micro_usd: "1000",
        ledger_count: 1,
        outcome: "failed",
        request_count: 1,
        stable_error_code: "model_unavailable",
        state: "failed",
        status: "settled",
      },
    ]);
  });

  it("rolls back terminal settlement when fencing rejects completion", async () => {
    const store = repository();
    const acquired = await store.begin(command());
    if (acquired.kind !== "acquired") throw new Error("Reservation was not acquired.");
    await store.markDispatched({ ...command(), reservationId: acquired.reservationId });
    await expect(
      store.complete({
        ...command(),
        billedCalls: [
          {
            costMicroUsd: 10,
            usage: { cachedInputTokens: 0, inputTokens: 4, outputTokens: 2 },
          },
        ],
        leaseToken: "wrong",
        reservationId: acquired.reservationId,
        response: { itemRevision: 1, suggestions: [] },
      }),
    ).rejects.toMatchObject({ code: "generation_busy" });
    const state = await database.query<{ ledger_count: number; status: string }>(`SELECT status,
      (SELECT count(*)::integer FROM usage_ledger) ledger_count FROM quota_reservations`);
    expect(state.rows).toEqual([{ ledger_count: 0, status: "active" }]);
  });

  it("atomically settles billed provider failures and replays their stable error", async () => {
    const store = repository();
    const acquired = await store.begin(command());
    if (acquired.kind !== "acquired") throw new Error("Reservation was not acquired.");
    await store.markDispatched({ ...command(), reservationId: acquired.reservationId });
    await store.fail({
      ...command(),
      billedCalls: [
        {
          costMicroUsd: 23,
          usage: { cachedInputTokens: 1, inputTokens: 8, outputTokens: 3 },
        },
      ],
      reservationId: acquired.reservationId,
      stableErrorCode: "model_output_invalid",
    });
    await expect(store.begin(command())).rejects.toMatchObject({ code: "model_output_invalid" });
    const terminal = await database.query<{
      cost_micro_usd: string;
      outcome: string;
      stable_error_code: string;
      status: string;
    }>(`SELECT requests.stable_error_code,reservations.status,ledger.outcome,
      ledger.cost_micro_usd::text FROM learning_duplicate_suggestion_requests requests
      JOIN quota_reservations reservations ON reservations.id=requests.reservation_id
      JOIN usage_ledger ledger ON ledger.request_id=requests.id`);
    expect(terminal.rows).toEqual([
      {
        cost_micro_usd: "23",
        outcome: "failed",
        stable_error_code: "model_output_invalid",
        status: "settled",
      },
    ]);
  });
});
