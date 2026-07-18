import type { ProcessRunner } from "../runtime/codex-process.js";
import { ProcessAbortedError, ProcessTimeoutError } from "../runtime/codex-process.js";
import { eudicError } from "../wordbook/eudic-errors.js";
import type { EudicAuthorizationReader } from "../wordbook/eudic-wordbook-provider.js";

export const EUDIC_SECURITY_EXECUTABLE = "/usr/bin/security";
export const EUDIC_KEYCHAIN_SERVICE = "com.huayi.codex_bridge.eudic";
export const EUDIC_KEYCHAIN_ACCOUNT = "authorization";
export const EUDIC_KEYCHAIN_LABEL = "Huayi Eudic OpenAPI Authorization";

export const EUDIC_KEYCHAIN_TIMEOUT_MS = 5_000;
export const MAXIMUM_EUDIC_AUTHORIZATION_BYTES = 8 * 1024;
export const MAXIMUM_EUDIC_AUTHORIZATION_CHARACTERS = 4_096;

const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;

export interface MacosEudicAuthorizationReaderOptions {
  environment: NodeJS.ProcessEnv;
  processRunner: ProcessRunner;
  securityExecutable?: string;
  workingDirectory: string;
}

export function validateEudicAuthorization(stdout: string): string {
  const authorization = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  const hasControlCharacter = [...authorization].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (
    authorization.length < 1 ||
    authorization.length > MAXIMUM_EUDIC_AUTHORIZATION_CHARACTERS ||
    authorization.trim() !== authorization ||
    hasControlCharacter
  ) {
    throw eudicError("EUDIC_AUTH_FAILED");
  }
  return authorization;
}

export class MacosEudicAuthorizationReader implements EudicAuthorizationReader {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly processRunner: ProcessRunner;
  private readonly securityExecutable: string;
  private readonly workingDirectory: string;

  constructor(options: MacosEudicAuthorizationReaderOptions) {
    this.environment = options.environment;
    this.processRunner = options.processRunner;
    this.securityExecutable = options.securityExecutable ?? EUDIC_SECURITY_EXECUTABLE;
    this.workingDirectory = options.workingDirectory;
  }

  async read(signal: AbortSignal): Promise<string> {
    if (signal.aborted) {
      throw eudicError("CANCELLED");
    }

    try {
      const result = await this.processRunner.run({
        arguments: [
          "find-generic-password",
          "-s",
          EUDIC_KEYCHAIN_SERVICE,
          "-a",
          EUDIC_KEYCHAIN_ACCOUNT,
          "-w",
        ],
        cwd: this.workingDirectory,
        env: this.environment,
        executable: this.securityExecutable,
        input: "",
        maximumOutputBytes: MAXIMUM_EUDIC_AUTHORIZATION_BYTES,
        signal,
        timeoutMs: EUDIC_KEYCHAIN_TIMEOUT_MS,
      });
      if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
        throw eudicError("EUDIC_NOT_CONFIGURED");
      }
      if (result.exitCode !== 0 || result.signal !== null) {
        throw eudicError("INTERNAL_ERROR");
      }
      return validateEudicAuthorization(result.stdout);
    } catch (error) {
      if (signal.aborted || error instanceof ProcessAbortedError) {
        throw eudicError("CANCELLED");
      }
      if (error instanceof ProcessTimeoutError) {
        throw eudicError("TIMEOUT");
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string" &&
        [
          "CANCELLED",
          "EUDIC_AUTH_FAILED",
          "EUDIC_NOT_CONFIGURED",
          "INTERNAL_ERROR",
          "TIMEOUT",
        ].includes(error.code)
      ) {
        throw error;
      }
      throw eudicError("INTERNAL_ERROR");
    }
  }
}
