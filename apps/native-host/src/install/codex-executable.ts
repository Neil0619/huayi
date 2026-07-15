import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

async function canonicalExecutable(path: string): Promise<string> {
  await access(path, constants.X_OK);
  return realpath(path);
}

export async function resolveCodexExecutable(
  explicitPath: string | undefined,
  pathEnvironment: string | undefined,
): Promise<string> {
  if (explicitPath !== undefined) {
    if (!isAbsolute(explicitPath)) {
      throw new TypeError("Explicit Codex path must be absolute.");
    }
    try {
      return await canonicalExecutable(explicitPath);
    } catch (error) {
      throw new Error("Codex CLI executable is not accessible.", { cause: error });
    }
  }

  for (const directory of pathEnvironment?.split(delimiter) ?? []) {
    if (!isAbsolute(directory)) continue;
    try {
      return await canonicalExecutable(join(directory, "codex"));
    } catch {
      // Continue through the explicit PATH allowlist without invoking a shell.
    }
  }
  throw new Error("Codex CLI executable was not found in PATH.");
}
