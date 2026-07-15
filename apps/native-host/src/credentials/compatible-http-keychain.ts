import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  buildAllowedEnvironment,
  ProcessAbortedError,
  ProcessTimeoutError,
} from "../runtime/codex-process.js";

export const COMPATIBLE_HTTP_SECURITY_EXECUTABLE = "/usr/bin/security";
export const COMPATIBLE_HTTP_KEYCHAIN_SERVICE = "com.huayi.codex_bridge.compatible_http";
export const COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT = "api-key";
export const COMPATIBLE_HTTP_KEYCHAIN_LABEL = "Huayi OpenAI-Compatible HTTP API Key";

export const COMPATIBLE_HTTP_KEYCHAIN_TIMEOUT_MS = 5_000;
export const MAXIMUM_COMPATIBLE_HTTP_API_KEY_BYTES = 8 * 1024;
export const MAXIMUM_COMPATIBLE_HTTP_API_KEY_CHARACTERS = 4_096;

const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;

export type CompatibleHttpCredentialErrorCode =
  | "MODEL_PROVIDER_NOT_CONFIGURED"
  | "MODEL_PROVIDER_AUTH_FAILED"
  | "TIMEOUT"
  | "CANCELLED"
  | "INTERNAL_ERROR";

export class CompatibleHttpCredentialError extends Error {
  constructor(readonly code: CompatibleHttpCredentialErrorCode) {
    super("Compatible HTTP credential operation failed.");
    this.name = "CompatibleHttpCredentialError";
  }
}

export interface CompatibleHttpApiKeyReaderOptions {
  environment: NodeJS.ProcessEnv;
  processRunner: ProcessRunner;
  workingDirectory: string;
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
    apiKey.length > MAXIMUM_COMPATIBLE_HTTP_API_KEY_CHARACTERS ||
    apiKey.trim() !== apiKey ||
    hasControlCharacter
  ) {
    throw new CompatibleHttpCredentialError("MODEL_PROVIDER_AUTH_FAILED");
  }
  return apiKey;
}

export class CompatibleHttpApiKeyReader {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly processRunner: ProcessRunner;
  private readonly workingDirectory: string;

  constructor(options: CompatibleHttpApiKeyReaderOptions) {
    this.environment = buildAllowedEnvironment(options.environment);
    this.processRunner = options.processRunner;
    this.workingDirectory = options.workingDirectory;
  }

  async read(signal: AbortSignal): Promise<string> {
    if (signal.aborted) {
      throw new CompatibleHttpCredentialError("CANCELLED");
    }

    try {
      const result = await this.processRunner.run({
        arguments: [
          "find-generic-password",
          "-s",
          COMPATIBLE_HTTP_KEYCHAIN_SERVICE,
          "-a",
          COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT,
          "-w",
        ],
        cwd: this.workingDirectory,
        env: this.environment,
        executable: COMPATIBLE_HTTP_SECURITY_EXECUTABLE,
        input: "",
        maximumOutputBytes: MAXIMUM_COMPATIBLE_HTTP_API_KEY_BYTES,
        signal,
        timeoutMs: COMPATIBLE_HTTP_KEYCHAIN_TIMEOUT_MS,
      });
      if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
        throw new CompatibleHttpCredentialError("MODEL_PROVIDER_NOT_CONFIGURED");
      }
      if (result.exitCode !== 0 || result.signal !== null) {
        throw new CompatibleHttpCredentialError("INTERNAL_ERROR");
      }
      return validateApiKey(result.stdout);
    } catch (error) {
      if (signal.aborted || error instanceof ProcessAbortedError) {
        throw new CompatibleHttpCredentialError("CANCELLED");
      }
      if (error instanceof ProcessTimeoutError) {
        throw new CompatibleHttpCredentialError("TIMEOUT");
      }
      if (error instanceof CompatibleHttpCredentialError) {
        throw error;
      }
      throw new CompatibleHttpCredentialError("INTERNAL_ERROR");
    }
  }
}
