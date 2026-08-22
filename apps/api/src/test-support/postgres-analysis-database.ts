import type { AnalysisDatabase, AnalysisQuery } from "../analysis-database.js";

interface TestPostgresExecutor {
  exec(text: string): Promise<unknown>;
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}

interface TestPostgresDatabase {
  transaction<Result>(
    operation: (transaction: TestPostgresExecutor) => Promise<Result>,
  ): Promise<Result>;
}

function query(executor: TestPostgresExecutor): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

export function createPgliteAnalysisDatabase(database: TestPostgresDatabase): AnalysisDatabase {
  return {
    async transaction(ownerUserId, operation) {
      return database.transaction(async (transaction) => {
        await transaction.exec("SET LOCAL ROLE huayi_context_setter");
        await transaction.query("SELECT huayi_private.set_owner_context($1)", [ownerUserId]);
        return operation({
          tenant: {
            rows: async (text, parameters) => {
              await transaction.exec("SET LOCAL ROLE huayi_business");
              return query(transaction).rows(text, parameters);
            },
          },
          trusted: {
            rows: async (text, parameters) => {
              await transaction.exec("SET LOCAL ROLE huayi_context_setter");
              return query(transaction).rows(text, parameters);
            },
          },
        });
      });
    },
    async trusted(operation) {
      return database.transaction(async (transaction) => {
        await transaction.exec("SET LOCAL ROLE huayi_context_setter");
        return operation(query(transaction));
      });
    },
  };
}
