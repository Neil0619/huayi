import { exactCronAbsent } from "./acceptance-hosted-cron-bootstrap-state.mjs";
import { hostedCronStatusArgument } from "./acceptance-hosted-cron.mjs";
import { hostedAcceptancePoolerUrl } from "./acceptance-hosted-foundation.mjs";

export class HostedCronBootstrapError extends Error {
  constructor(stage) {
    super(`Hosted Cron bootstrap failed at stage: ${stage}.`);
    this.name = "HostedCronBootstrapError";
    this.stage = stage;
  }
}

export function failHostedCronBootstrap(stage) {
  throw new HostedCronBootstrapError(stage);
}

export function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validSecret(value, { maximum, minimum }) {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value) >= minimum &&
    Buffer.byteLength(value) <= maximum &&
    value.trim() === value &&
    !/[\0\r\n]/u.test(value)
  );
}

export function parseCronSecret(result, stage) {
  if (result?.code !== 0 || typeof result.stdout !== "string") {
    failHostedCronBootstrap(stage);
  }
  const match = /^([0-9a-f]{64})\n$/u.exec(result.stdout);
  if (match === null) failHostedCronBootstrap(stage);
  return match[1];
}

export async function readInfrastructure({ environment, fetchCaCertificate, readCredential }) {
  try {
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readCredential("supabase-admin-db-password", {
      environment,
    });
    if (!validSecret(administratorPassword, { maximum: 512, minimum: 12 })) {
      failHostedCronBootstrap("credentials");
    }
    return { administratorPassword, caCertificate };
  } catch {
    failHostedCronBootstrap("credentials");
  }
}

export async function requireRepositoryCandidate(verifyRepositoryCandidate) {
  try {
    if ((await verifyRepositoryCandidate()) !== true) {
      failHostedCronBootstrap("repository-candidate");
    }
  } catch {
    failHostedCronBootstrap("repository-candidate");
  }
}

export async function readR3cSnapshot(secrets, runSnapshotQuery) {
  try {
    const snapshot = await runSnapshotQuery(secrets);
    if (!record(snapshot)) failHostedCronBootstrap("r3c-pending");
    return snapshot;
  } catch {
    failHostedCronBootstrap("r3c-pending");
  }
}

export async function requireCronAbsent({ environment, readCronStatus, runPsql, secrets }) {
  try {
    const status = await readCronStatus({
      arguments_: ["status", hostedCronStatusArgument],
      environment,
      fetchCaCertificate: async () => secrets.caCertificate,
      readPassword: async () => secrets.administratorPassword,
      runPsql,
    });
    if (!exactCronAbsent(status)) failHostedCronBootstrap("cron-absent");
  } catch (error) {
    if (error instanceof HostedCronBootstrapError) throw error;
    failHostedCronBootstrap("cron-absent");
  }
}

export function databaseRequest(secrets) {
  return {
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: secrets.caCertificate,
    },
    password: secrets.administratorPassword,
    timeoutMilliseconds: 30_000,
  };
}

export async function requestWorker({ cronSecret, fetch_, stage, url }) {
  try {
    const response = await fetch_(url, {
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response?.ok || response.status !== 200) failHostedCronBootstrap(stage);
    const text = await response.text();
    if (text.length === 0 || text.length > 1_024) failHostedCronBootstrap(stage);
    const parsed = JSON.parse(text);
    if (!record(parsed) || Object.keys(parsed).length !== 1) failHostedCronBootstrap(stage);
    return parsed.outcome;
  } catch (error) {
    if (error instanceof HostedCronBootstrapError) throw error;
    failHostedCronBootstrap(stage);
  }
}
