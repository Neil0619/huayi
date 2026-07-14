import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  buildAllowedEnvironment,
  ProcessAbortedError,
  ProcessTimeoutError,
} from "../runtime/codex-process.js";

export const OPENAI_SECURITY_EXECUTABLE = "/usr/bin/security";
export const OPENAI_KEYCHAIN_SERVICE = "com.huayi.codex_bridge.openai";
export const OPENAI_KEYCHAIN_ACCOUNT = "api-key";
export const OPENAI_KEYCHAIN_LABEL = "Huayi OpenAI API Key";

export const OPENAI_KEYCHAIN_TIMEOUT_MS = 5_000;
export const MAXIMUM_OPENAI_API_KEY_BYTES = 8 * 1024;
export const MAXIMUM_OPENAI_API_KEY_CHARACTERS = 4_096;

const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;

export class OpenAICredentialError extends Error {
  constructor(
    readonly code:
      | "MODEL_PROVIDER_NOT_CONFIGURED"
      | "MODEL_PROVIDER_AUTH_FAILED"
      | "TIMEOUT"
      | "CANCELLED"
      | "INTERNAL_ERROR",
  ) {
    super("OpenAI credential operation failed.");
    this.name = "OpenAICredentialError";
  }
}

export interface OpenAIApiKeyReaderOptions {
  environment: NodeJS.ProcessEnv;
  processRunner: ProcessRunner;
  securityExecutable?: string;
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
    apiKey.length > MAXIMUM_OPENAI_API_KEY_CHARACTERS ||
    apiKey.trim() !== apiKey ||
    hasControlCharacter
  ) {
    throw new OpenAICredentialError("MODEL_PROVIDER_AUTH_FAILED");
  }
  return apiKey;
}

export class OpenAIApiKeyReader {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly processRunner: ProcessRunner;
  private readonly securityExecutable: string;
  private readonly workingDirectory: string;

  constructor(options: OpenAIApiKeyReaderOptions) {
    this.environment = buildAllowedEnvironment(options.environment);
    this.processRunner = options.processRunner;
    this.securityExecutable = options.securityExecutable ?? OPENAI_SECURITY_EXECUTABLE;
    this.workingDirectory = options.workingDirectory;
  }

  async read(signal: AbortSignal): Promise<string> {
    if (signal.aborted) {
      throw new OpenAICredentialError("CANCELLED");
    }

    try {
      const result = await this.processRunner.run({
        arguments: [
          "find-generic-password",
          "-s",
          OPENAI_KEYCHAIN_SERVICE,
          "-a",
          OPENAI_KEYCHAIN_ACCOUNT,
          "-w",
        ],
        cwd: this.workingDirectory,
        env: this.environment,
        executable: this.securityExecutable,
        input: "",
        maximumOutputBytes: MAXIMUM_OPENAI_API_KEY_BYTES,
        signal,
        timeoutMs: OPENAI_KEYCHAIN_TIMEOUT_MS,
      });
      if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
        throw new OpenAICredentialError("MODEL_PROVIDER_NOT_CONFIGURED");
      }
      if (result.exitCode !== 0 || result.signal !== null) {
        throw new OpenAICredentialError("INTERNAL_ERROR");
      }
      return validateApiKey(result.stdout);
    } catch (error) {
      if (signal.aborted || error instanceof ProcessAbortedError) {
        throw new OpenAICredentialError("CANCELLED");
      }
      if (error instanceof ProcessTimeoutError) {
        throw new OpenAICredentialError("TIMEOUT");
      }
      if (error instanceof OpenAICredentialError) {
        throw error;
      }
      throw new OpenAICredentialError("INTERNAL_ERROR");
    }
  }
}
