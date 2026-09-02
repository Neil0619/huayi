import {
  createHostedDeepSeekOneShotProductionExecutor,
  createHostedDeepSeekOneShotProductionSnapshotAdapter,
} from "./acceptance-hosted-deepseek-one-shot-composition.mjs";
import { readHostedDeepSeekOperatorCredentials } from "./acceptance-hosted-deepseek-one-shot-credentials.mjs";
import { createHostedDeepSeekOneShotExecutor } from "./acceptance-hosted-deepseek-one-shot.mjs";
import { createHostedDeepSeekPostgresAuthority } from "./acceptance-hosted-deepseek-one-shot-postgres-authority.mjs";
import { createHostedDeepSeekProductionDatabase } from "./acceptance-hosted-deepseek-one-shot-production-database.mjs";
import { loadHostedDeepSeekAcceptanceKeyring } from "./acceptance-hosted-deepseek-one-shot-production-keyring.mjs";
import { createHostedDeepSeekProductionSnapshotReader } from "./acceptance-hosted-deepseek-one-shot-production-snapshot.mjs";
import {
  readHostedAdministratorPassword,
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

const failureMessage = "Hosted Cloud Web DeepSeek production loader failed closed.";

function fail() {
  throw new Error(failureMessage);
}

function passwordIsValid(value) {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value) >= 12 &&
    Buffer.byteLength(value) <= 512 &&
    !/[\0\r\n]/u.test(value)
  );
}

function hiddenCredentials(credentials) {
  if (
    typeof credentials !== "object" ||
    credentials === null ||
    typeof credentials.email !== "string" ||
    typeof credentials.password !== "string"
  ) {
    fail();
  }
  const hidden = {};
  Object.defineProperties(hidden, {
    email: { enumerable: false, value: credentials.email },
    password: { enumerable: false, value: credentials.password },
  });
  return Object.freeze(hidden);
}

function createStatusOnlyExecutor({ query } = {}) {
  const unavailableKeyring = Object.freeze({
    create: fail,
    recover: fail,
  });
  const lifecycle = createHostedDeepSeekPostgresAuthority({
    keyring: unavailableKeyring,
    query,
  });
  return createHostedDeepSeekOneShotExecutor({ adapter: Object.freeze({}), lifecycle });
}

function closingExecutor(core, close) {
  let invoked = false;
  async function invoke(method, arguments_) {
    if (invoked || typeof core?.[method] !== "function" || typeof close !== "function") fail();
    invoked = true;
    let result;
    let failed = false;
    try {
      result = await core[method](...arguments_);
    } catch {
      failed = true;
    }
    try {
      await close();
    } catch {
      failed = true;
    }
    if (failed) fail();
    return result;
  }
  return Object.freeze({
    execute: (...arguments_) => invoke("execute", arguments_),
    recover: (...arguments_) => invoke("recover", arguments_),
    status: (...arguments_) => invoke("status", arguments_),
  });
}

export async function createHostedDeepSeekProductionExecutorForCommand({
  command,
  createDatabase = createHostedDeepSeekProductionDatabase,
  createExecutor = createHostedDeepSeekOneShotProductionExecutor,
  createSnapshotAdapter = createHostedDeepSeekOneShotProductionSnapshotAdapter,
  createSnapshotReader = createHostedDeepSeekProductionSnapshotReader,
  createStatusExecutor = createStatusOnlyExecutor,
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  loadKeyring = loadHostedDeepSeekAcceptanceKeyring,
  readAdministratorPassword = readHostedAdministratorPassword,
  readCredential = readHostedCredential,
  readOperatorCredentials = readHostedDeepSeekOperatorCredentials,
  repositoryRoot = process.cwd(),
} = {}) {
  let database;
  try {
    if (
      !new Set(["execute", "recover", "status"]).has(command) ||
      typeof createDatabase !== "function" ||
      typeof fetchCaCertificate !== "function" ||
      typeof readAdministratorPassword !== "function"
    ) {
      fail();
    }
    rejectLegacyHostedCredentialEnvironment(environment);
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readAdministratorPassword({ environment });
    if (!passwordIsValid(administratorPassword)) fail();
    database = createDatabase({ administratorPassword, caCertificate });
    if (
      typeof database?.administratorReadQuery !== "function" ||
      typeof database?.executorQuery !== "function" ||
      typeof database?.ready !== "function" ||
      typeof database?.close !== "function"
    ) {
      fail();
    }
    await database.ready();

    if (command === "status") {
      const core = createStatusExecutor({ query: database.executorQuery });
      return closingExecutor(core, database.close);
    }

    if (
      typeof createExecutor !== "function" ||
      typeof createSnapshotAdapter !== "function" ||
      typeof createSnapshotReader !== "function" ||
      typeof loadKeyring !== "function" ||
      typeof readCredential !== "function" ||
      typeof readOperatorCredentials !== "function" ||
      typeof repositoryRoot !== "string" ||
      repositoryRoot.length === 0
    ) {
      fail();
    }
    const keyring = await loadKeyring({
      createIfMissing: command === "execute",
      environment,
    });
    const vercelToken = await readCredential("vercel-token", { environment });
    const credentials = hiddenCredentials(await readOperatorCredentials());
    const evidence = createSnapshotReader({ query: database.administratorReadQuery });
    const snapshot = createSnapshotAdapter({
      readPostEvidence: evidence.readPostEvidence,
      readPreEvidence: evidence.readPreEvidence,
      repositoryRoot,
      vercelToken,
    });
    const core = createExecutor({
      credentials,
      keyring,
      query: database.executorQuery,
      snapshot,
    });
    return closingExecutor(core, database.close);
  } catch {
    try {
      await database?.close?.();
    } catch {
      // The public failure remains fixed even if connection cleanup also fails.
    }
    fail();
  }
}
