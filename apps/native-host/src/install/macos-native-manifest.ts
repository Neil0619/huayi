import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface MacosManifestWriteHandle {
  chmod(mode: 0o600): Promise<void>;
  close(): Promise<void>;
  stat(): Promise<{
    isFile(): boolean;
    readonly mode: number;
  }>;
  sync(): Promise<void>;
  write(contents: string): Promise<void>;
}

export interface MacosManifestWriteOperations {
  open(path: string, flags: "wx", mode: 0o600): Promise<MacosManifestWriteHandle>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}

const nodeManifestWriteOperations: MacosManifestWriteOperations = {
  async open(path, flags, mode) {
    const handle = await open(path, flags, mode);
    return {
      chmod: (fileMode) => handle.chmod(fileMode),
      close: () => handle.close(),
      stat: () => handle.stat(),
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

export async function writeMacosNativeManifest(
  manifestPath: string,
  contents: string,
  operations: MacosManifestWriteOperations = nodeManifestWriteOperations,
): Promise<void> {
  const parentDirectory = dirname(manifestPath);
  const temporaryPath = join(
    parentDirectory,
    `.${basename(manifestPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: MacosManifestWriteHandle | undefined;
  let temporaryFileCreated = false;
  try {
    handle = await operations.open(temporaryPath, "wx", 0o600);
    temporaryFileCreated = true;
    await handle.chmod(0o600);
    const stats = await handle.stat();
    if (!stats.isFile() || (stats.mode & 0o7777) !== 0o600) {
      throw new Error("Chrome manifest temporary file has unsafe permissions.");
    }
    await handle.write(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await operations.rename(temporaryPath, manifestPath);
    temporaryFileCreated = false;
    await operations.syncDirectory(parentDirectory);
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // The original failure remains authoritative; temporary-file cleanup continues below.
      }
    }
    if (temporaryFileCreated) {
      try {
        await operations.remove(temporaryPath);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Chrome manifest write and temporary-file cleanup failed.",
        );
      }
    }
    throw error;
  }
}
