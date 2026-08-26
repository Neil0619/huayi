import { readFile } from "node:fs/promises";

import { hostedCronStatusFieldNames } from "./acceptance-hosted-cron.mjs";

export const postgresPassword = "fictional-postgres-password";
export const rootCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
export const safeEnvironment = Object.freeze({});
export const credentialDependencies = Object.freeze({
  fetchCaCertificate: async () => rootCertificate,
  readPassword: async () => postgresPassword,
});
export const applyDependencies = Object.freeze({
  ...credentialDependencies,
  verifyRepositoryCandidate: async () => true,
});
export const operationsSql = await readFile(
  new URL("../apps/api/operations/configure-supabase-cron.sql", import.meta.url),
  "utf8",
);

function statusValues({ installed = false, ready = true } = {}) {
  return {
    administrator_connection_exact: "t",
    cron_acl_exact: installed ? "t" : "f",
    cron_extensions_exact: installed ? "t" : "f",
    cron_extensions_installable: "t",
    cron_fixed_jobs_count: installed ? "5" : "0",
    cron_function_contract_exact: installed ? "t" : "f",
    cron_function_installable: "t",
    cron_installation_exact: installed ? "t" : "f",
    cron_installation_state: installed ? "exact" : "absent",
    cron_jobs_exact: installed ? "t" : "f",
    cron_preflight_ready: ready ? "t" : "f",
    cron_unmanaged_jobs_count: "0",
    cron_vault_names_exact: "t",
    migration_chain_exact: "t",
    r3c_contract_exact: "t",
    r3c_nonterminal_count: "0",
    r3c_sent_count: "1",
    r3c_terminal_failure_count: "0",
  };
}

export function statusOutput(options) {
  const values = statusValues(options);
  return hostedCronStatusFieldNames.map((name) => `${name}|${values[name]}`).join("\n") + "\n";
}
