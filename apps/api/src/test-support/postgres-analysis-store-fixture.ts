import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { AnalysisDatabase, AnalysisQuery } from "../analysis-database.js";

const migrationUrl = new URL("../../migrations/0001-cloud-v1-foundation.sql", import.meta.url);

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

export async function createPostgresAnalysisStoreFixture(ids: {
  userA: string;
  userB: string;
  reservationId: string;
  requestId: string;
  priceId: string;
}) {
  const { userA, userB, reservationId, requestId, priceId } = ids;
  const database = new PGlite();
  await database.waitReady;
  await database.exec(await readFile(migrationUrl, "utf8"));
  const adapter: AnalysisDatabase = {
    async transaction(ownerUserId, operation) {
      return database.transaction(async (transaction) => {
        await transaction.exec("SET LOCAL ROLE huayi_context_setter");
        await transaction.query("SELECT huayi_private.set_owner_context($1)", [ownerUserId]);
        const tenant = query(transaction);
        const trusted = query(transaction);
        return operation({
          tenant: {
            rows: async (text, parameters) => {
              await transaction.exec("SET LOCAL ROLE huayi_business");
              return tenant.rows(text, parameters);
            },
          },
          trusted: {
            rows: async (text, parameters) => {
              await transaction.exec("SET LOCAL ROLE huayi_context_setter");
              return trusted.rows(text, parameters);
            },
          },
        });
      });
    },
    async trusted(operation) {
      return database.transaction((transaction) => operation(query(transaction)));
    },
  };
  await database.exec(`INSERT INTO user_profiles (user_id,owner_user_id,email,status,timezone,daily_goal)
    VALUES ('${userA}','${userA}','a@example.test','active','UTC',5),
      ('${userB}','${userB}','b@example.test','active','UTC',5);
    INSERT INTO model_price_versions (id,provider,model,input_micro_usd_per_million,
      cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from)
    VALUES ('${priceId}','deepseek','fake',1,1,1,now());
    INSERT INTO quota_grants (id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source)
    VALUES ('60000000-0000-0000-0000-000000000001','${userA}','${userA}',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',1000,'default');
    INSERT INTO quota_reservations (id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at)
    VALUES ('${reservationId}','${userA}','${userA}','${requestId}',date_trunc('month',now()),100,'active',now()+interval '2 minutes');
    INSERT INTO analysis_requests (id,owner_user_id,idempotency_key,request_hash,unit_count,state,
      lease_token,lease_expires_at,reservation_id,price_version_id,recovery_ledger_id)
    VALUES ('${requestId}','${userA}','key-1',repeat('a',64),1,'running','lease-1',
      now()+interval '2 minutes','${reservationId}','${priceId}',
      '71000000-0000-0000-0000-000000000001');`);
  return { database, adapter };
}
