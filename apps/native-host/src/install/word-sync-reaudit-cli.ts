import { englishWordSchema } from "@huayi/protocol";

import { reauditLegacyCompleted } from "../word-sync/word-sync-legacy-reaudit.js";
import { WordSyncStateStore } from "../word-sync/word-sync-state.js";
import { createMacosInstallationPaths } from "./paths.js";
import { createWindowsInstallationPaths } from "./windows-paths.js";

export interface WordSyncReauditCommand {
  confirm: boolean;
  probe?: string;
  type: "word-sync-reaudit";
}

export interface WordSyncReauditRuntime {
  homeDirectory: string;
  localAppDataDirectory?: string;
  platform: NodeJS.Platform;
  writeOutput(message: string): void;
}

export function resolveWordSyncReauditStatePath(
  runtime: Pick<WordSyncReauditRuntime, "homeDirectory" | "localAppDataDirectory" | "platform">,
): string {
  if (runtime.platform === "darwin") {
    return createMacosInstallationPaths(runtime.homeDirectory).wordSyncStatePath;
  }
  if (runtime.platform === "win32") {
    return createWindowsInstallationPaths(runtime.localAppDataDirectory ?? "").wordSyncStatePath;
  }
  throw new Error("Word-sync re-audit supports macOS and Windows only.");
}

function argumentValue(arguments_: readonly string[], index: number, option: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires an argument.`);
  }
  return value;
}

export function parseWordSyncReauditCommand(
  arguments_: readonly string[],
): WordSyncReauditCommand | undefined {
  if (arguments_[0] !== "word-sync-reaudit") return undefined;
  let confirm = false;
  let probe: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--confirm-requeue-legacy") {
      if (confirm) throw new Error("Duplicate confirmation flag.");
      confirm = true;
    } else if (argument === "--probe") {
      if (probe !== undefined) throw new Error("Duplicate probe option.");
      const parsedProbe = englishWordSchema.safeParse(argumentValue(arguments_, index, argument));
      if (!parsedProbe.success) {
        throw new Error("--probe requires one valid English word.");
      }
      probe = parsedProbe.data;
      index += 1;
    } else if (argument !== "--") {
      throw new Error(`Unknown installer argument: ${argument ?? ""}.`);
    }
  }
  return {
    confirm,
    ...(probe === undefined ? {} : { probe }),
    type: "word-sync-reaudit",
  };
}

export async function executeWordSyncReauditCommand(
  command: WordSyncReauditCommand,
  runtime: WordSyncReauditRuntime,
): Promise<void> {
  const statePath = resolveWordSyncReauditStatePath(runtime);
  const result = await reauditLegacyCompleted(new WordSyncStateStore({ path: statePath }), {
    confirm: command.confirm,
    ...(command.probe === undefined ? {} : { probe: command.probe }),
  });
  const noun = result.legacyCount === 1 ? "word" : "words";
  runtime.writeOutput(
    result.dryRun
      ? `[dry-run] ${result.legacyCount} legacy ${noun} ${
          result.legacyCount === 1 ? "is" : "are"
        } eligible for re-audit.`
      : `Requeued ${result.requeuedCount} of ${result.legacyCount} legacy ${noun} for re-audit.`,
  );
}
