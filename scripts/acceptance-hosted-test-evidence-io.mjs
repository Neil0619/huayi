import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";

export function createEvidenceTestIo(modeOverrides) {
  return {
    async hashFile(path) {
      return createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    },
    async lstat(path) {
      const stats = await lstat(path);
      return {
        isDirectory: () => stats.isDirectory(),
        isFile: () => stats.isFile(),
        mode: modeOverrides.get(path) ?? (stats.isDirectory() ? 0o700 : 0o600),
        size: stats.size,
      };
    },
    readFile,
    readdir,
  };
}
