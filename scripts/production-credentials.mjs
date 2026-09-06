import { pathToFileURL } from "node:url";

import {
  rejectLegacyHostedCredentialEnvironment,
  runSecurityCommand,
} from "./acceptance-hosted-credentials.mjs";

export const productionCredentialService = "cn.seen-said.huayi.production";
const initializationCredentialIds = Object.freeze([
  "supabase-management-token",
  "supabase-admin-db-password",
]);
export const productionCredentialIds = Object.freeze([
  ...initializationCredentialIds,
  "deepseek-api-key",
  "resend-smtp-key",
  "resend-notification-key",
]);

const credentialLabels = Object.freeze({
  "supabase-management-token": "语见正式环境 Supabase management token",
  "supabase-admin-db-password": "语见正式环境 Supabase administrator database password",
  "deepseek-api-key": "语见正式环境 DeepSeek API key",
  "resend-smtp-key": "语见正式环境 Resend SMTP sending key",
  "resend-notification-key": "语见正式环境 Resend notification sending key",
});

const credentialPrompts = Object.freeze({
  "supabase-management-token":
    "请输入刚生成的 Supabase 管理令牌（以 sbp_ 开头），这里不是数据库密码。",
  "supabase-admin-db-password": "请输入创建 Production 项目时保存的数据库密码。",
  "deepseek-api-key": "请输入为正式环境单独创建的 DeepSeek API key（以 sk- 开头）。",
  "resend-smtp-key":
    "请输入正式域 notify.seen-said.cn 专用的 Resend SMTP 发送 key（以 re_ 开头）。",
  "resend-notification-key":
    "请输入正式域 notify.seen-said.cn 专用的 Resend 通知发送 key（以 re_ 开头）。",
});

export class ProductionCredentialError extends Error {
  constructor() {
    super("Production credential is unavailable.");
    this.name = "ProductionCredentialError";
  }
}

function assertInput(credentialId, environment, platform) {
  rejectLegacyHostedCredentialEnvironment(environment);
  if (
    platform !== "darwin" ||
    !productionCredentialIds.includes(credentialId) ||
    [
      "HUAYI_PRODUCTION_MANAGEMENT_TOKEN",
      "HUAYI_PRODUCTION_DATABASE_PASSWORD",
      "HUAYI_PRODUCTION_APP_DATABASE_PASSWORD",
      "HUAYI_PRODUCTION_DEEPSEEK_API_KEY",
      "HUAYI_PRODUCTION_RESEND_SMTP_KEY",
      "HUAYI_PRODUCTION_RESEND_NOTIFICATION_KEY",
    ].some((name) => Object.hasOwn(environment, name))
  )
    throw new ProductionCredentialError();
}

function readArguments(credentialId, includePassword = false) {
  return [
    "find-generic-password",
    "-s",
    productionCredentialService,
    "-a",
    credentialId,
    ...(includePassword ? ["-w"] : []),
  ];
}

function credentialIsValid(credentialId, value) {
  if (typeof value !== "string" || /[\0\r\n]/u.test(value)) return false;
  const size = Buffer.byteLength(value);
  if (credentialId === "supabase-admin-db-password") return size >= 12 && size <= 512;
  if (credentialId === "supabase-management-token") {
    return size >= 16 && size <= 4_096 && /^sbp_\S+$/u.test(value);
  }
  return (
    size >= 16 &&
    size <= 128 &&
    (credentialId === "deepseek-api-key" ? /^sk-\S+$/u : /^re_\S+$/u).test(value)
  );
}

export async function readProductionCredential(
  credentialId,
  { environment = process.env, platform = process.platform, runSecurity = runSecurityCommand } = {},
) {
  try {
    assertInput(credentialId, environment, platform);
    const result = await runSecurity({
      arguments_: readArguments(credentialId, true),
      environment,
      interactive: false,
    });
    const value = result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : undefined;
    if (result.code !== 0 || !credentialIsValid(credentialId, value)) {
      throw new ProductionCredentialError();
    }
    return value;
  } catch {
    throw new ProductionCredentialError();
  }
}

function parseArguments(arguments_) {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  const operation = args.shift();
  if (args[0] === "--") args.shift();
  if (!new Set(["configure", "rotate", "status"]).has(operation)) return undefined;
  if (args.length === 0)
    return operation === "rotate" ? undefined : { operation, ids: initializationCredentialIds };
  if (args.length !== 2 || args[0] !== "--name" || !productionCredentialIds.includes(args[1])) {
    return undefined;
  }
  return { operation, ids: [args[1]] };
}

export async function runProductionCredentialsCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  platform = process.platform,
  runSecurity = runSecurityCommand,
  stdinIsTTY = process.stdin.isTTY === true,
  stderrIsTTY = process.stderr.isTTY === true,
  writeOutput = (value) => process.stdout.write(value),
  writeError = (value) => process.stderr.write(value),
} = {}) {
  try {
    const command = parseArguments(arguments_);
    if (!command || (command.operation !== "status" && (!stdinIsTTY || !stderrIsTTY))) {
      throw new ProductionCredentialError();
    }
    const preflight = [];
    for (const id of command.ids) {
      assertInput(id, environment, platform);
      const result = await runSecurity({
        arguments_: readArguments(id),
        environment,
        interactive: false,
      });
      if (result.code !== 0 && result.code !== 44) throw new ProductionCredentialError();
      const state = result.code === 0 ? "present" : "missing";
      if (command.operation === "configure" && state === "present") {
        await readProductionCredential(id, { environment, platform, runSecurity });
      }
      preflight.push([id, state]);
    }
    for (const [id, state] of preflight) {
      if (
        command.operation === "status" ||
        (command.operation === "configure" && state === "present")
      ) {
        writeOutput(`credential|${id}|${state}\n`);
        continue;
      }
      writeOutput(`credential|${id}|input-required\n`);
      writeOutput(`${credentialPrompts[id]}系统输入时不显示字符。\n`);
      const result = await runSecurity({
        arguments_: [
          "add-generic-password",
          ...(command.operation === "rotate" ? ["-U"] : []),
          "-s",
          productionCredentialService,
          "-a",
          id,
          "-l",
          credentialLabels[id],
          "-w",
        ],
        environment,
        interactive: true,
      });
      if (result.code !== 0) throw new ProductionCredentialError();
      await readProductionCredential(id, { environment, platform, runSecurity });
      writeOutput(
        `credential|${id}|${command.operation === "rotate" ? "rotated" : "configured"}\n`,
      );
    }
    return command.operation === "status" && preflight.some(([, state]) => state === "missing")
      ? 1
      : 0;
  } catch {
    writeError(
      platform === "darwin"
        ? "Production credential command failed; no secret values are displayed.\n"
        : "Production credential command requires macOS Keychain.\n",
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runProductionCredentialsCli();
}
