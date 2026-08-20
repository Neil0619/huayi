import postgres, { type Sql } from "postgres";

export function createRuntimeSql(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 4, prepare: false, transform: { undefined: null } });
}
