import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  buildAllowedEnvironment,
  ProcessAbortedError,
  ProcessTimeoutError,
} from "../runtime/codex-process.js";

export const DEEPSEEK_SECURITY_EXECUTABLE = "/usr/bin/security";
export const DEEPSEEK_KEYCHAIN_SERVICE = "com.huayi.codex_bridge.deepseek";
export const DEEPSEEK_KEYCHAIN_ACCOUNT = "api-key";
export const DEEPSEEK_KEYCHAIN_LABEL = "Huayi DeepSeek API Key";
export const DEEPSEEK_KEYCHAIN_TIMEOUT_MS = 5_000;
export const MAXIMUM_DEEPSEEK_API_KEY_BYTES = 8 * 1024;
export const MAXIMUM_DEEPSEEK_API_KEY_CHARACTERS = 4_096;

const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;

export type DeepSeekCredentialErrorCode =
  | "MODEL_PROVIDER_NOT_CONFIGURED"
  | "MODEL_PROVIDER_AUTH_FAILED"
  | "TIMEOUT"
  | "CANCELLED"
  | "INTERNAL_ERROR";

export class DeepSeekCredentialError extends Error {
  constructor(readonly code: DeepSeekCredentialErrorCode) {
    super("DeepSeek credential operation failed.");
    this.name = "DeepSeekCredentialError";
  }
}

export interface DeepSeekApiKeyReaderOptions {
  readonly environment: NodeJS.ProcessEnv;
  readonly processRunner: ProcessRunner;
  readonly workingDirectory: string;
}

function validateApiKey(stdout: string): string {
  const apiKey = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  const hasControlCharacter = [...apiKey].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
  if (
    apiKey.length < 1 ||
    apiKey.length > MAXIMUM_DEEPSEEK_API_KEY_CHARACTERS ||
    apiKey.trim() !== apiKey ||
    hasControlCharacter
  ) {
    throw new DeepSeekCredentialError("MODEL_PROVIDER_AUTH_FAILED");
  }
  return apiKey;
}

export class DeepSeekApiKeyReader {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #processRunner: ProcessRunner;
  readonly #workingDirectory: string;

  constructor(options: DeepSeekApiKeyReaderOptions) {
    this.#environment = buildAllowedEnvironment(options.environment);
    this.#processRunner = options.processRunner;
    this.#workingDirectory = options.workingDirectory;
  }

  async read(signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new DeepSeekCredentialError("CANCELLED");
    try {
      const result = await this.#processRunner.run({
        arguments: [
          "find-generic-password",
          "-s",
          DEEPSEEK_KEYCHAIN_SERVICE,
          "-a",
          DEEPSEEK_KEYCHAIN_ACCOUNT,
          "-w",
        ],
        cwd: this.#workingDirectory,
        env: this.#environment,
        executable: DEEPSEEK_SECURITY_EXECUTABLE,
        input: "",
        maximumOutputBytes: MAXIMUM_DEEPSEEK_API_KEY_BYTES,
        signal,
        timeoutMs: DEEPSEEK_KEYCHAIN_TIMEOUT_MS,
      });
      if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
        throw new DeepSeekCredentialError("MODEL_PROVIDER_NOT_CONFIGURED");
      }
      if (result.exitCode !== 0 || result.signal !== null) {
        throw new DeepSeekCredentialError("INTERNAL_ERROR");
      }
      return validateApiKey(result.stdout);
    } catch (error) {
      if (signal.aborted || error instanceof ProcessAbortedError) {
        throw new DeepSeekCredentialError("CANCELLED");
      }
      if (error instanceof ProcessTimeoutError) throw new DeepSeekCredentialError("TIMEOUT");
      if (error instanceof DeepSeekCredentialError) throw error;
      throw new DeepSeekCredentialError("INTERNAL_ERROR");
    }
  }
}
