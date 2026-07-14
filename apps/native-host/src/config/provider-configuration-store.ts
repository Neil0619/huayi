import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { ModelProvider } from "@huayi/protocol";

import {
  providerConfigurationSchema,
  type ProviderConfiguration,
} from "./provider-configuration.js";

const MAX_PROVIDER_CONFIGURATION_BYTES = 4 * 1024;

export interface ProviderConfigurationResult {
  readonly dryRun: boolean;
  readonly provider: ModelProvider;
}

export interface ProviderConfigurationReadHandle {
  close(): Promise<void>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number }>;
  stat(): Promise<{ isFile(): boolean; readonly size: number }>;
}

export interface ProviderConfigurationReadOperations {
  open(path: string, flags: number): Promise<ProviderConfigurationReadHandle>;
}

export interface ProviderConfigurationWriteHandle {
  close(): Promise<void>;
  sync(): Promise<void>;
  write(contents: string): Promise<void>;
}

export interface ProviderConfigurationWriteOperations {
  open(path: string, flags: "wx", mode: 0o600): Promise<ProviderConfigurationWriteHandle>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}

const nodeWriteOperations: ProviderConfigurationWriteOperations = {
  async open(path, flags, mode) {
    const handle = await open(path, flags, mode);
    return {
      close: () => handle.close(),
      sync: () => handle.sync(),
      write: async (contents) => {
        await handle.writeFile(contents, "utf8");
      },
    };
  },
  async remove(path) {
    await rm(path, { force: true });
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

const nodeReadOperations: ProviderConfigurationReadOperations = {
  async open(path, flags) {
    return open(path, flags);
  },
};

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function renderConfiguration(provider: ModelProvider): string {
  const configuration: ProviderConfiguration = { provider, schemaVersion: 1 };
  return `${JSON.stringify(configuration, null, 2)}\n`;
}

export class ProviderConfigurationStore {
  constructor(
    private readonly configurationPath: string,
    private readonly writeOperations: ProviderConfigurationWriteOperations = nodeWriteOperations,
    private readonly readOperations: ProviderConfigurationReadOperations = nodeReadOperations,
  ) {}

  async read(signal?: AbortSignal): Promise<ModelProvider> {
    signal?.throwIfAborted();
    let handle: ProviderConfigurationReadHandle;
    try {
      handle = await this.readOperations.open(
        this.configurationPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if (isMissingFileError(error)) {
        signal?.throwIfAborted();
        return "codex";
      }
      throw error;
    }
    try {
      signal?.throwIfAborted();
      const stats = await handle.stat();
      signal?.throwIfAborted();
      if (!stats.isFile()) {
        throw new Error("Provider configuration must be a regular file.");
      }
      if (stats.size > MAX_PROVIDER_CONFIGURATION_BYTES) {
        throw new Error("Provider configuration must not exceed 4 KiB.");
      }

      const buffer = Buffer.alloc(MAX_PROVIDER_CONFIGURATION_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        signal?.throwIfAborted();
        const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (result.bytesRead === 0) {
          break;
        }
        bytesRead += result.bytesRead;
      }
      signal?.throwIfAborted();
      if (bytesRead > MAX_PROVIDER_CONFIGURATION_BYTES) {
        throw new Error("Provider configuration must not exceed 4 KiB.");
      }

      let value: unknown;
      try {
        value = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
      } catch (error) {
        throw new Error("Provider configuration is invalid JSON.", { cause: error });
      }
      const result = providerConfigurationSchema.safeParse(value);
      if (!result.success) {
        throw new Error("Provider configuration has an invalid shape.", { cause: result.error });
      }
      return result.data.provider;
    } finally {
      await handle.close();
    }
  }

  async write(provider: ModelProvider, dryRun: boolean): Promise<ProviderConfigurationResult> {
    const result = { dryRun, provider } as const;
    if (dryRun) {
      return result;
    }

    const parentDirectory = dirname(this.configurationPath);
    const temporaryPath = join(
      parentDirectory,
      `.${basename(this.configurationPath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let handle: ProviderConfigurationWriteHandle | undefined;
    let temporaryFileCreated = false;
    try {
      handle = await this.writeOperations.open(temporaryPath, "wx", 0o600);
      temporaryFileCreated = true;
      await handle.write(renderConfiguration(provider));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.writeOperations.rename(temporaryPath, this.configurationPath);
      await this.writeOperations.syncDirectory(parentDirectory);
      return result;
    } catch (error) {
      if (handle !== undefined) {
        try {
          await handle.close();
        } catch {
          // The original write failure remains authoritative; cleanup continues below.
        }
      }
      if (temporaryFileCreated) {
        try {
          await this.writeOperations.remove(temporaryPath);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Provider configuration write and temporary-file cleanup failed.",
          );
        }
      }
      throw error;
    }
  }
}
