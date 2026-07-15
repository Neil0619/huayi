import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  compatibleHttpConfigurationSchema,
  type CompatibleHttpConfiguration,
} from "./compatible-http-configuration.js";

const MAX_COMPATIBLE_HTTP_CONFIGURATION_BYTES = 4 * 1024;
const NEVER_ABORTED_SIGNAL = new AbortController().signal;

export type CompatibleHttpConfigurationErrorCode =
  "MODEL_PROVIDER_NOT_CONFIGURED" | "INTERNAL_ERROR";

export class CompatibleHttpConfigurationError extends Error {
  constructor(readonly code: CompatibleHttpConfigurationErrorCode) {
    super("Compatible HTTP configuration operation failed.");
    this.name = "CompatibleHttpConfigurationError";
  }
}

export interface CompatibleConfigurationOperationResult {
  readonly actions: readonly string[];
  readonly dryRun: boolean;
}

export interface CompatibleHttpConfigurationReadHandle {
  close(): Promise<void>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number }>;
  stat(): Promise<{
    isFile(): boolean;
    readonly mode: number;
    readonly size: number;
    readonly uid: number;
  }>;
}

export interface CompatibleHttpConfigurationReadOperations {
  currentUserId(): number;
  open(path: string, flags: number): Promise<CompatibleHttpConfigurationReadHandle>;
}

export interface CompatibleHttpConfigurationWriteHandle {
  chmod(mode: 0o600): Promise<void>;
  close(): Promise<void>;
  stat(): Promise<{
    isFile(): boolean;
    readonly mode: number;
  }>;
  sync(): Promise<void>;
  write(contents: string): Promise<void>;
}

export interface CompatibleHttpConfigurationWriteOperations {
  open(path: string, flags: "wx", mode: 0o600): Promise<CompatibleHttpConfigurationWriteHandle>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}

const nodeReadOperations: CompatibleHttpConfigurationReadOperations = {
  currentUserId() {
    if (typeof process.getuid !== "function") {
      throw new Error("Compatible HTTP configuration ownership cannot be verified.");
    }
    return process.getuid();
  },
  async open(path, flags) {
    return open(path, flags);
  },
};

const nodeWriteOperations: CompatibleHttpConfigurationWriteOperations = {
  async open(path, flags, mode) {
    const handle = await open(path, flags, mode);
    return {
      chmod: () => handle.chmod(0o600),
      close: () => handle.close(),
      stat: () => handle.stat(),
      sync: () => handle.sync(),
      write: async (contents) => {
        await handle.writeFile(contents, "utf8");
      },
    };
  },
  async remove(path) {
    await unlink(path);
  },
  rename,
  async syncDirectory(path) {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function internalConfigurationError(): CompatibleHttpConfigurationError {
  return new CompatibleHttpConfigurationError("INTERNAL_ERROR");
}

function renderConfiguration(configuration: CompatibleHttpConfiguration): string {
  return `${JSON.stringify(configuration, null, 2)}\n`;
}

export class CompatibleHttpConfigurationStore {
  constructor(
    private readonly configurationPath: string,
    private readonly writeOperations: CompatibleHttpConfigurationWriteOperations = nodeWriteOperations,
    private readonly readOperations: CompatibleHttpConfigurationReadOperations = nodeReadOperations,
  ) {}

  async read(signal: AbortSignal): Promise<CompatibleHttpConfiguration> {
    signal.throwIfAborted();
    let handle: CompatibleHttpConfigurationReadHandle;
    try {
      handle = await this.readOperations.open(
        this.configurationPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      signal.throwIfAborted();
      if (isMissingFileError(error)) {
        throw new CompatibleHttpConfigurationError("MODEL_PROVIDER_NOT_CONFIGURED");
      }
      throw internalConfigurationError();
    }
    try {
      return await this.readOwnedHandle(handle, signal);
    } catch {
      signal.throwIfAborted();
      throw internalConfigurationError();
    }
  }

  async write(
    configuration: CompatibleHttpConfiguration,
    dryRun: boolean,
  ): Promise<CompatibleConfigurationOperationResult> {
    await this.validateExistingTarget();
    const parsed = compatibleHttpConfigurationSchema.safeParse(configuration);
    if (!parsed.success) {
      throw internalConfigurationError();
    }
    const contents = renderConfiguration(parsed.data);
    if (Buffer.byteLength(contents, "utf8") > MAX_COMPATIBLE_HTTP_CONFIGURATION_BYTES) {
      throw internalConfigurationError();
    }
    const result = {
      actions: [`Write compatible HTTP configuration ${this.configurationPath}`],
      dryRun,
    } as const;
    if (dryRun) {
      return result;
    }

    const parentDirectory = dirname(this.configurationPath);
    const temporaryPath = join(
      parentDirectory,
      `.${basename(this.configurationPath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let handle: CompatibleHttpConfigurationWriteHandle | undefined;
    let temporaryFileCreated = false;
    try {
      handle = await this.writeOperations.open(temporaryPath, "wx", 0o600);
      temporaryFileCreated = true;
      await handle.chmod(0o600);
      const stats = await handle.stat();
      if (!stats.isFile() || (stats.mode & 0o7777) !== 0o600) {
        throw new Error("Compatible HTTP temporary configuration has unsafe permissions.");
      }
      await handle.write(contents);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.writeOperations.rename(temporaryPath, this.configurationPath);
      await this.writeOperations.syncDirectory(parentDirectory);
      return result;
    } catch {
      if (handle !== undefined) {
        try {
          await handle.close();
        } catch {
          // Cleanup is best effort; callers receive only the fixed safe error below.
        }
      }
      if (temporaryFileCreated) {
        try {
          await this.writeOperations.remove(temporaryPath);
        } catch (cleanupError) {
          if (!isMissingFileError(cleanupError)) {
            throw internalConfigurationError();
          }
        }
      }
      throw internalConfigurationError();
    }
  }

  async remove(dryRun: boolean): Promise<CompatibleConfigurationOperationResult> {
    if (!(await this.validateExistingTarget())) {
      return { actions: [], dryRun };
    }
    const result = {
      actions: [`Remove compatible HTTP configuration ${this.configurationPath}`],
      dryRun,
    } as const;
    if (dryRun) {
      return result;
    }

    try {
      await this.writeOperations.remove(this.configurationPath);
    } catch (error) {
      if (isMissingFileError(error)) {
        return { actions: [], dryRun: false };
      }
      throw internalConfigurationError();
    }
    try {
      await this.writeOperations.syncDirectory(dirname(this.configurationPath));
    } catch {
      throw internalConfigurationError();
    }
    return result;
  }

  private async readOwnedHandle(
    handle: CompatibleHttpConfigurationReadHandle,
    signal: AbortSignal,
  ): Promise<CompatibleHttpConfiguration> {
    try {
      signal.throwIfAborted();
      const stats = await handle.stat();
      signal.throwIfAborted();
      if (!stats.isFile()) {
        throw new Error("Compatible HTTP configuration must be a regular file.");
      }
      if (stats.uid !== this.readOperations.currentUserId()) {
        throw new Error("Compatible HTTP configuration has unsafe ownership.");
      }
      if ((stats.mode & 0o7777) !== 0o600) {
        throw new Error("Compatible HTTP configuration has unsafe permissions.");
      }
      if (
        !Number.isSafeInteger(stats.size) ||
        stats.size < 0 ||
        stats.size > MAX_COMPATIBLE_HTTP_CONFIGURATION_BYTES
      ) {
        throw new Error("Compatible HTTP configuration has an unsafe size.");
      }

      const buffer = Buffer.alloc(MAX_COMPATIBLE_HTTP_CONFIGURATION_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        signal.throwIfAborted();
        const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (result.bytesRead === 0) {
          break;
        }
        bytesRead += result.bytesRead;
      }
      signal.throwIfAborted();
      if (bytesRead > MAX_COMPATIBLE_HTTP_CONFIGURATION_BYTES) {
        throw new Error("Compatible HTTP configuration has an unsafe size.");
      }

      let value: unknown;
      try {
        value = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
      } catch {
        throw new Error("Compatible HTTP configuration is invalid JSON.");
      }
      const parsed = compatibleHttpConfigurationSchema.safeParse(value);
      if (!parsed.success) {
        throw new Error("Compatible HTTP configuration has an invalid shape.");
      }
      signal.throwIfAborted();
      return parsed.data;
    } finally {
      await handle.close();
    }
  }

  private async validateExistingTarget(): Promise<boolean> {
    try {
      await this.read(NEVER_ABORTED_SIGNAL);
      return true;
    } catch (error) {
      if (
        error instanceof CompatibleHttpConfigurationError &&
        error.code === "MODEL_PROVIDER_NOT_CONFIGURED"
      ) {
        return false;
      }
      throw error;
    }
  }
}
