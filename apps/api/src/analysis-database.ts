import type { JSONValue, ParameterOrJSON, Sql, TransactionSql } from "postgres";

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

export function preparePostgresParameters(
  text: string,
  parameters: readonly unknown[],
): ParameterOrJSON<never>[] {
  const jsonbIndexes = new Set<number>();
  for (const match of text.matchAll(/\$(\d+)\s*::\s*jsonb\b/giu)) {
    const ordinal = Number(match[1]);
    if (Number.isSafeInteger(ordinal) && ordinal > 0) jsonbIndexes.add(ordinal - 1);
  }
  return parameters.map((parameter, index) => {
    if (!jsonbIndexes.has(index) || typeof parameter !== "string") {
      return postgresParameter(parameter);
    }
    try {
      return postgresParameter(JSON.parse(parameter) as unknown);
    } catch {
      throw new Error("Invalid JSONB database parameter.");
    }
  });
}

function postgresParameter(value: unknown): ParameterOrJSON<never> {
  if (value instanceof Uint8Array) return value;
  return jsonValue(value);
}

function jsonValue(value: unknown): JSONValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    value instanceof Date
  )
    return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  throw new Error("Invalid database parameter.");
}

function query(sql: TransactionSql): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      sql.unsafe<Row[]>(text, preparePostgresParameters(text, parameters)),
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
