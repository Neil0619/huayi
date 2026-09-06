import { randomBytes } from "node:crypto";
import {
  rejectLegacyHostedCredentialEnvironment,
  runSecurityCommand,
} from "./acceptance-hosted-credentials.mjs";
import { runHostedKeychainPromptCommand } from "./acceptance-hosted-deepseek-one-shot-production-keyring.mjs";
import { productionCredentialService } from "./production-credentials.mjs";

const account = "runtime-generated-secrets-v1";
const fields = Object.freeze({
  databasePassword: 48,
  refreshEncryptionKey: 32,
  secretPepper: 32,
  cronSecret: 32,
});
const failureMessage = "Production runtime credential unavailable.";

function parseStored(result) {
  if (result.code !== 0 || typeof result.stdout !== "string" || !result.stdout.endsWith("\n")) {
    throw new Error(failureMessage);
  }
  const source = result.stdout.slice(0, -1);
  if (source.length > 1024 || /[\0\r\n]/u.test(source)) throw new Error(failureMessage);
  const value = JSON.parse(source);
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(Object.keys(fields).sort())
  )
    throw new Error(failureMessage);
  for (const [name, size] of Object.entries(fields)) {
    const key = value[name];
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]+$/u.test(key)) throw new Error(failureMessage);
    const bytes = Buffer.from(key, "base64url");
    if (bytes.length !== size || bytes.toString("base64url") !== key)
      throw new Error(failureMessage);
  }
  if (new Set(Object.values(value)).size !== 4) throw new Error(failureMessage);
  return value;
}

export async function loadProductionRuntimeSecrets({
  createIfMissing = false,
  environment = process.env,
  platform = process.platform,
  randomBytes_ = randomBytes,
  runSecurity = runSecurityCommand,
  runSecurityPrompt = runHostedKeychainPromptCommand,
} = {}) {
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
    if (platform !== "darwin" || typeof createIfMissing !== "boolean") throw new Error();
    const identity = ["-s", productionCredentialService, "-a", account];
    const read = () =>
      runSecurity({
        arguments_: ["find-generic-password", ...identity, "-w"],
        environment,
        interactive: false,
      });
    const existing = await read();
    if (existing.code === 0) return parseStored(existing);
    if (!createIfMissing || existing.code !== 44) throw new Error();
    const generated = Object.fromEntries(
      Object.entries(fields).map(([name, size]) => {
        const bytes = randomBytes_(size);
        if (!(bytes instanceof Uint8Array) || bytes.length !== size) throw new Error();
        return [name, Buffer.from(bytes).toString("base64url")];
      }),
    );
    const value = JSON.stringify(generated);
    parseStored({ code: 0, stdout: value + "\n" });
    const write = await runSecurityPrompt({
      arguments_: ["add-generic-password", ...identity, "-l", "语见正式环境独立运行密钥", "-w"],
      environment,
      value,
      timeoutMilliseconds: 20000,
    });
    const stored = parseStored(await read());
    if (write.code !== 0 || Object.keys(fields).some((name) => stored[name] !== generated[name])) {
      throw new Error();
    }
    return stored;
  } catch {
    throw new Error(failureMessage);
  }
}
