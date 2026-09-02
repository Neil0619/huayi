import { hostedAcceptancePoolerUrl, runHostedPsql } from "./acceptance-hosted-foundation.mjs";

export const hostedPasswordRecoveryBootstrapSnapshotFields = Object.freeze([
  "password_recovery_open_total",
  "password_recovery_claimable",
  "password_recovery_sent",
  "password_recovery_ambiguous",
]);

const countPattern = /^(?:0|[1-9]\d{0,18})$/u;

function validCount(value) {
  return (
    typeof value === "string" &&
    countPattern.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n
  );
}

function parseSnapshot(stdout) {
  if (
    typeof stdout !== "string" ||
    stdout.length === 0 ||
    stdout.length > 1_024 ||
    !stdout.endsWith("\n") ||
    stdout.includes("\r")
  ) {
    return null;
  }
  const lines = stdout.slice(0, -1).split("\n");
  if (lines.length !== hostedPasswordRecoveryBootstrapSnapshotFields.length) return null;
  const snapshot = {};
  for (const [index, name] of hostedPasswordRecoveryBootstrapSnapshotFields.entries()) {
    const tokens = lines[index]?.split("|");
    if (tokens?.length !== 2 || tokens[0] !== name || !validCount(tokens[1])) return null;
    snapshot[name] = tokens[1];
  }
  return Object.freeze(snapshot);
}

export function renderHostedPasswordRecoveryBootstrapSnapshotSql() {
  return `BEGIN READ ONLY;
WITH recovery AS (
  SELECT
    count(*) FILTER (WHERE flows.stage NOT IN ('completed','failed'))::bigint
      AS password_recovery_open_total,
    count(*) FILTER (WHERE flows.stage='requested'
      AND flows.dispatch_at IS NULL
      AND flows.expires_at > now()
      AND (flows.dispatch_lease_expires_at IS NULL
        OR flows.dispatch_lease_expires_at <= now())
      AND EXISTS (
        SELECT 1
        FROM public.user_profiles AS profiles
        JOIN public.account_sign_in_methods AS methods
          ON methods.owner_user_id=profiles.user_id AND methods.method='password'
        WHERE profiles.user_id=flows.owner_user_id AND profiles.status='active'
      ))::bigint AS password_recovery_claimable,
    count(*) FILTER (WHERE flows.stage='sent' AND flows.expires_at > now())::bigint
      AS password_recovery_sent,
    count(*) FILTER (WHERE flows.stage='requested' AND flows.dispatch_at IS NOT NULL)::bigint
      AS password_recovery_ambiguous
  FROM public.password_recovery_flows AS flows
)
SELECT * FROM recovery
\\gset
SELECT 'password_recovery_open_total|' || :'password_recovery_open_total';
SELECT 'password_recovery_claimable|' || :'password_recovery_claimable';
SELECT 'password_recovery_sent|' || :'password_recovery_sent';
SELECT 'password_recovery_ambiguous|' || :'password_recovery_ambiguous';
ROLLBACK;
`;
}

export async function runHostedPasswordRecoveryBootstrapSnapshotQuery(
  { administratorPassword, caCertificate },
  { runPsql = runHostedPsql } = {},
) {
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    },
    input: renderHostedPasswordRecoveryBootstrapSnapshotSql(),
    password: administratorPassword,
    timeoutMilliseconds: 30_000,
  });
  return result.code === 0 ? parseSnapshot(result.stdout) : null;
}
