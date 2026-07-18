import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  buildAllowedEnvironment,
  ProcessAbortedError,
  ProcessTimeoutError,
} from "../runtime/codex-process.js";
import { eudicError } from "../wordbook/eudic-errors.js";
import type { EudicAuthorizationReader } from "../wordbook/eudic-wordbook-provider.js";
import {
  EUDIC_KEYCHAIN_TIMEOUT_MS,
  MAXIMUM_EUDIC_AUTHORIZATION_BYTES,
  validateEudicAuthorization,
} from "./eudic-keychain.js";

const CREDENTIAL_NOT_FOUND_EXIT_CODE = 3;

export interface WindowsEudicAuthorizationReaderOptions {
  readonly credentialHelperPath: string;
  readonly credentialPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly powershellExecutable: string;
  readonly processRunner: ProcessRunner;
  readonly workingDirectory: string;
}

export class WindowsEudicAuthorizationReader implements EudicAuthorizationReader {
  readonly #credentialHelperPath: string;
  readonly #credentialPath: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #powershellExecutable: string;
  readonly #processRunner: ProcessRunner;
  readonly #workingDirectory: string;

  constructor(options: WindowsEudicAuthorizationReaderOptions) {
    this.#credentialHelperPath = options.credentialHelperPath;
    this.#credentialPath = options.credentialPath;
    this.#environment = buildAllowedEnvironment(options.environment);
    this.#powershellExecutable = options.powershellExecutable;
    this.#processRunner = options.processRunner;
    this.#workingDirectory = options.workingDirectory;
  }

  async read(signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw eudicError("CANCELLED");
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
        maximumOutputBytes: MAXIMUM_EUDIC_AUTHORIZATION_BYTES,
        signal,
        timeoutMs: EUDIC_KEYCHAIN_TIMEOUT_MS,
      });
      if (result.exitCode === CREDENTIAL_NOT_FOUND_EXIT_CODE) {
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
      if (error instanceof ProcessTimeoutError) throw eudicError("TIMEOUT");
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
