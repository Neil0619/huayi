import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  buildAllowedEnvironment,
  ProcessAbortedError,
  ProcessTimeoutError,
} from "../runtime/codex-process.js";
import {
  DeepSeekCredentialError,
  DEEPSEEK_KEYCHAIN_TIMEOUT_MS,
  MAXIMUM_DEEPSEEK_API_KEY_BYTES,
  validateDeepSeekApiKey,
} from "./deepseek-keychain.js";

const CREDENTIAL_NOT_FOUND_EXIT_CODE = 3;

export interface WindowsDeepSeekApiKeyReaderOptions {
  readonly credentialHelperPath: string;
  readonly credentialPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly powershellExecutable: string;
  readonly processRunner: ProcessRunner;
  readonly workingDirectory: string;
}

export class WindowsDeepSeekApiKeyReader {
  readonly #credentialHelperPath: string;
  readonly #credentialPath: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #powershellExecutable: string;
  readonly #processRunner: ProcessRunner;
  readonly #workingDirectory: string;

  constructor(options: WindowsDeepSeekApiKeyReaderOptions) {
    this.#credentialHelperPath = options.credentialHelperPath;
    this.#credentialPath = options.credentialPath;
    this.#environment = buildAllowedEnvironment(options.environment);
    this.#powershellExecutable = options.powershellExecutable;
    this.#processRunner = options.processRunner;
    this.#workingDirectory = options.workingDirectory;
  }

  async read(signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new DeepSeekCredentialError("CANCELLED");
    try {
      const result = await this.#processRunner.run({
        arguments: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.#credentialHelperPath,
          "read",
          this.#credentialPath,
        ],
        cwd: this.#workingDirectory,
        env: this.#environment,
        executable: this.#powershellExecutable,
        input: "",
        maximumOutputBytes: MAXIMUM_DEEPSEEK_API_KEY_BYTES,
        signal,
        timeoutMs: DEEPSEEK_KEYCHAIN_TIMEOUT_MS,
      });
      if (result.exitCode === CREDENTIAL_NOT_FOUND_EXIT_CODE) {
        throw new DeepSeekCredentialError("MODEL_PROVIDER_NOT_CONFIGURED");
      }
      if (result.exitCode !== 0 || result.signal !== null) {
        throw new DeepSeekCredentialError("INTERNAL_ERROR");
      }
      return validateDeepSeekApiKey(result.stdout);
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
