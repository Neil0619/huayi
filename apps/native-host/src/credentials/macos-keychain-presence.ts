import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  buildAllowedEnvironment,
  ProcessAbortedError,
  ProcessTimeoutError,
} from "../runtime/codex-process.js";

const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;

export class KeychainPresenceError extends Error {
  constructor(
    readonly code: "MODEL_PROVIDER_NOT_CONFIGURED" | "CANCELLED" | "INTERNAL_ERROR" | "TIMEOUT",
  ) {
    super("Keychain presence check failed.");
    this.name = "KeychainPresenceError";
  }
}

export interface MacosKeychainPresenceProbeOptions {
  account: string;
  environment: NodeJS.ProcessEnv;
  processRunner: ProcessRunner;
  securityExecutable: string;
  service: string;
  workingDirectory: string;
}

export class MacosKeychainPresenceProbe {
  readonly #account: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #processRunner: ProcessRunner;
  readonly #securityExecutable: string;
  readonly #service: string;
  readonly #workingDirectory: string;

  constructor(options: MacosKeychainPresenceProbeOptions) {
    this.#account = options.account;
    this.#environment = buildAllowedEnvironment(options.environment);
    this.#processRunner = options.processRunner;
    this.#securityExecutable = options.securityExecutable;
    this.#service = options.service;
    this.#workingDirectory = options.workingDirectory;
  }

  async read(signal: AbortSignal): Promise<true> {
    try {
      const result = await this.#processRunner.run({
        arguments: ["find-generic-password", "-s", this.#service, "-a", this.#account],
        cwd: this.#workingDirectory,
        env: this.#environment,
        executable: this.#securityExecutable,
        input: "",
        maximumOutputBytes: 8 * 1024,
        signal,
        timeoutMs: 5_000,
      });
      if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
        throw new KeychainPresenceError("MODEL_PROVIDER_NOT_CONFIGURED");
      }
      if (result.exitCode !== 0 || result.signal !== null) {
        throw new KeychainPresenceError("INTERNAL_ERROR");
      }
      return true;
    } catch (error) {
      if (signal.aborted || error instanceof ProcessAbortedError) {
        throw new KeychainPresenceError("CANCELLED");
      }
      if (error instanceof ProcessTimeoutError) throw new KeychainPresenceError("TIMEOUT");
      if (error instanceof KeychainPresenceError) throw error;
      throw new KeychainPresenceError("INTERNAL_ERROR");
    }
  }
}
