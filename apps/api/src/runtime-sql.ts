import postgres, { type Sql } from "postgres";

export function createRuntimeSql(databaseUrl: string, tlsCa?: string): Sql {
  const verifyFull = new URL(databaseUrl).searchParams.get("sslmode") === "verify-full";
  if (verifyFull !== (tlsCa !== undefined)) {
    throw new Error("Hosted database TLS configuration is incomplete.");
  }
  return postgres(databaseUrl, {
    max: 4,
    prepare: false,
    ssl: tlsCa === undefined ? false : { ca: tlsCa, rejectUnauthorized: true },
    transform: { undefined: null },
  });
}
