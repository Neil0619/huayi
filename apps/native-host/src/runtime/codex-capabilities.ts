import {
  buildAllowedEnvironment,
  type ProcessRunResult,
  type ProcessRunner,
} from "./codex-process.js";
import { capabilityMissingError, notAuthenticatedError } from "./error-mapper.js";

const CAPABILITY_TIMEOUT_MS = 10_000;
const REQUIRED_EXEC_FLAGS = [
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--strict-config",
  "--disable",
  "--sandbox",
  "--skip-git-repo-check",
  "--output-schema",
  "--color",
  "--cd",
  "--config",
] as const;
const DISABLED_SHELL_FEATURES = ["shell_tool", "unified_exec", "shell_snapshot"] as const;

export interface CodexCapabilities {
  codexVersion: string;
}

export interface CodexCapabilityOptions {
  codexExecutable: string;
  environment: NodeJS.ProcessEnv;
  processRunner: ProcessRunner;
  workingDirectory: string;
}

async function runCheck(
  options: CodexCapabilityOptions,
  arguments_: string[],
): Promise<ProcessRunResult> {
  return options.processRunner.run({
    arguments: arguments_,
    cwd: options.workingDirectory,
    env: buildAllowedEnvironment(options.environment),
    executable: options.codexExecutable,
    input: "",
    timeoutMs: CAPABILITY_TIMEOUT_MS,
  });
}

function hasDisabledShellFeatures(output: string): boolean {
  const featureStates = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u);
    const name = columns[0];
    const state = columns.at(-1);
    if (name !== undefined && state !== undefined) {
      featureStates.set(name, state);
    }
  }
  return DISABLED_SHELL_FEATURES.every((feature) => featureStates.get(feature) === "false");
}

export async function checkCodexCapabilities(
  options: CodexCapabilityOptions,
): Promise<CodexCapabilities> {
  let versionResult: ProcessRunResult;
  let helpResult: ProcessRunResult;
  let featureResult: ProcessRunResult;
  try {
    versionResult = await runCheck(options, ["--version"]);
    helpResult = await runCheck(options, ["exec", "--help"]);
    featureResult = await runCheck(options, [
      "features",
      "list",
      ...DISABLED_SHELL_FEATURES.flatMap((feature) => ["--disable", feature]),
    ]);
  } catch (error) {
    throw capabilityMissingError(error);
  }

  const codexVersion = versionResult.stdout.trim();
  if (
    versionResult.exitCode !== 0 ||
    helpResult.exitCode !== 0 ||
    featureResult.exitCode !== 0 ||
    codexVersion.length === 0 ||
    REQUIRED_EXEC_FLAGS.some((flag) => !helpResult.stdout.includes(flag)) ||
    !hasDisabledShellFeatures(featureResult.stdout)
  ) {
    throw capabilityMissingError();
  }

  let loginResult: ProcessRunResult;
  try {
    loginResult = await runCheck(options, ["login", "status"]);
  } catch (error) {
    throw notAuthenticatedError(error);
  }

  const loginOutput = `${loginResult.stdout}\n${loginResult.stderr}`;
  if (loginResult.exitCode !== 0 || !/logged in/i.test(loginOutput)) {
    throw notAuthenticatedError();
  }

  return { codexVersion };
}
