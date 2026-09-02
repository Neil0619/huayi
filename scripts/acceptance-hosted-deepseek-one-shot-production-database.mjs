import postgres from "postgres";

import {
  hostedAcceptancePoolerUrl,
  requirePostgresPassword,
} from "./acceptance-hosted-foundation.mjs";

const failureMessage = "Hosted Cloud Web DeepSeek production database failed closed.";
const statementBudgetMilliseconds = 5_000;
const authorityFunctions = new Set([
  "arm_hosted_acceptance_cleanup",
  "bind_hosted_acceptance_request",
  "claim_hosted_acceptance_cleanup",
  "claim_hosted_acceptance_operation",
  "complete_hosted_acceptance_cleanup",
  "complete_hosted_acceptance_operation",
  "mark_hosted_acceptance_dispatch",
  "read_hosted_acceptance_status",
  "record_hosted_acceptance_settlement",
  "retain_hosted_acceptance_evidence",
]);

function fail() {
  throw new Error(failureMessage);
}

function requireCaCertificate(value) {
  if (
    typeof value !== "string" ||
    value.length < 64 ||
    value.length > 16_384 ||
    !value.startsWith("-----BEGIN CERTIFICATE-----\n") ||
    !value.trimEnd().endsWith("-----END CERTIFICATE-----")
  ) {
    fail();
  }
  return value;
}

function connectionUrl() {
  try {
    const parsed = new URL(hostedAcceptancePoolerUrl);
    if (parsed.protocol !== "postgresql:" || parsed.password !== "") fail();
    parsed.search = "";
    return parsed.toString();
  } catch {
    fail();
  }
}

function controlIsValid(control) {
  return (
    control === undefined ||
    (typeof control === "object" &&
      control !== null &&
      !Array.isArray(control) &&
      control.signal instanceof AbortSignal &&
      (control.deadlineAt === undefined ||
        (Number.isSafeInteger(control.deadlineAt) && control.deadlineAt >= 0)))
  );
}

function authorityQueryIsValid(text) {
  if (
    !/^\s*SELECT\b/iu.test(text) ||
    /;|--|\/\*/u.test(text) ||
    /\b(?:ALTER|BEGIN|CALL|COMMIT|COPY|CREATE|DELETE|DO|DROP|GRANT|INSERT|RESET|REVOKE|ROLLBACK|SET|UPDATE)\b/iu.test(
      text,
    )
  ) {
    return false;
  }
  const matches = [...text.matchAll(/\bhuayi_private\.([a-z_]+)\s*\(/gu)];
  return matches.length === 1 && authorityFunctions.has(matches[0][1]);
}

function remainingBudget(control, readNowMilliseconds) {
  if (control?.signal.aborted === true) fail();
  if (control?.deadlineAt === undefined) return statementBudgetMilliseconds;
  const remaining = control.deadlineAt - readNowMilliseconds();
  if (!Number.isSafeInteger(remaining) || remaining <= 0) fail();
  return Math.min(statementBudgetMilliseconds, remaining);
}

async function runControlled(statement, control) {
  if (control === undefined) return statement;
  if (control.signal.aborted) {
    try {
      statement.cancel?.();
    } catch {
      // The public outcome is already fixed.
    }
    fail();
  }
  let rejectAbort;
  const abort = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    rejectAbort(new Error(failureMessage));
    try {
      statement.cancel?.();
    } catch {
      // The already-selected public outcome remains a fixed failure.
    }
  };
  control.signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([statement, abort]);
  } finally {
    control.signal.removeEventListener("abort", onAbort);
  }
}

function resultRows(result) {
  if (!Array.isArray(result) || result.length > 1_000) fail();
  return { rows: [...result] };
}

export function createHostedDeepSeekProductionDatabase({
  administratorPassword,
  caCertificate,
  connect = postgres,
  readNowMilliseconds = Date.now,
} = {}) {
  let password;
  try {
    password = requirePostgresPassword(administratorPassword);
  } catch {
    fail();
  }
  const ca = requireCaCertificate(caCertificate);
  if (typeof connect !== "function" || typeof readNowMilliseconds !== "function") fail();

  let sql;
  try {
    sql = connect(connectionUrl(), {
      connect_timeout: 5,
      idle_timeout: 5,
      max: 1,
      max_lifetime: 120,
      password,
      prepare: false,
      ssl: { ca, rejectUnauthorized: true },
      transform: { undefined: null },
    });
  } catch {
    fail();
  }
  if (typeof sql?.begin !== "function" || typeof sql?.end !== "function") fail();
  let closed = false;
  let readyPromise;

  async function query(mode, text, parameters = [], control) {
    try {
      if (
        closed ||
        !new Set(["administrator-read", "executor"]).has(mode) ||
        typeof text !== "string" ||
        text.length === 0 ||
        text.length > 100_000 ||
        !Array.isArray(parameters) ||
        parameters.length > 32 ||
        !controlIsValid(control) ||
        (mode === "executor" && !authorityQueryIsValid(text))
      ) {
        fail();
      }
      const budget = remainingBudget(control, readNowMilliseconds);
      const result = await sql.begin(async (transaction) => {
        if (typeof transaction?.unsafe !== "function") fail();
        if (mode === "administrator-read") {
          await transaction.unsafe("SET TRANSACTION READ ONLY");
        }
        await transaction.unsafe(`SET LOCAL statement_timeout = '${budget}ms'`);
        return runControlled(transaction.unsafe(text, parameters), control);
      });
      return resultRows(result);
    } catch {
      fail();
    }
  }

  return Object.freeze({
    administratorReadQuery: (text, parameters, control) =>
      query("administrator-read", text, parameters, control),
    async close() {
      if (closed) return;
      closed = true;
      try {
        await sql.end({ timeout: 5 });
      } catch {
        fail();
      }
    },
    executorQuery: (text, parameters, control) => query("executor", text, parameters, control),
    async ready() {
      if (closed) fail();
      readyPromise ??= query("administrator-read", 'SELECT 1::integer AS "value"', []).then(
        (result) => {
          if (
            result.rows.length !== 1 ||
            Object.keys(result.rows[0]).length !== 1 ||
            result.rows[0].value !== 1
          ) {
            fail();
          }
        },
      );
      try {
        await readyPromise;
      } catch {
        fail();
      }
    },
  });
}
