import type { Sql, TransactionSql } from "postgres";

export interface AnalysisQuery {
  rows<Row>(text: string, parameters?: readonly unknown[]): Promise<Row[]>;
}
export interface AnalysisDatabase {
  snapshot?<Result>(
    ownerUserId: string,
    operation: (queries: { tenant: AnalysisQuery; trusted: AnalysisQuery }) => Promise<Result>,
  ): Promise<Result>;
  transaction<Result>(
    ownerUserId: string,
    operation: (queries: { tenant: AnalysisQuery; trusted: AnalysisQuery }) => Promise<Result>,
  ): Promise<Result>;
  trusted<Result>(operation: (query: AnalysisQuery) => Promise<Result>): Promise<Result>;
}

function query(sql: TransactionSql): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) => sql.unsafe<Row[]>(text, [...parameters]),
  };
}

export function createPostgresAnalysisDatabase(sql: Sql): AnalysisDatabase {
  const tenantTransaction = <Result>(
    ownerUserId: string,
    isolation: "default" | "repeatable-read",
    operation: (queries: { tenant: AnalysisQuery; trusted: AnalysisQuery }) => Promise<Result>,
  ) =>
    sql.begin(async (transaction) => {
      if (isolation === "repeatable-read") {
        await transaction`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
      }
      await transaction`SET LOCAL ROLE huayi_context_setter`;
      await transaction`SELECT huayi_private.set_owner_context(${ownerUserId})`;
      const trusted: AnalysisQuery = {
        async rows<Row>(text: string, parameters: readonly unknown[] = []) {
          await transaction`SET LOCAL ROLE huayi_context_setter`;
          return query(transaction).rows<Row>(text, parameters);
        },
      };
      const tenant: AnalysisQuery = {
        async rows<Row>(text: string, parameters: readonly unknown[] = []) {
          await transaction`SET LOCAL ROLE huayi_business`;
          return query(transaction).rows<Row>(text, parameters);
        },
      };
      return operation({ tenant, trusted });
    }) as Promise<Awaited<ReturnType<typeof operation>>>;
  return {
    snapshot(ownerUserId, operation) {
      return tenantTransaction(ownerUserId, "repeatable-read", operation);
    },
    async transaction(ownerUserId, operation) {
      return tenantTransaction(ownerUserId, "default", operation);
    },
    async trusted(operation) {
      return sql.begin(async (transaction) => {
        await transaction`SET LOCAL ROLE huayi_context_setter`;
        return operation(query(transaction));
      }) as Promise<Awaited<ReturnType<typeof operation>>>;
    },
  };
}
