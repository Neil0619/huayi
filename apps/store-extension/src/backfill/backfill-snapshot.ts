import { backfillStatus } from "@huayi/store-domain";
import type { ExtensionSessionVault } from "../service-worker/extension-session-vault.js";
import { BackfillError, backfillErrorResponse } from "./backfill-errors.js";
import type { BackfillStorage, createBackfillVault } from "./backfill-vault.js";
import type { BackfillView } from "./backfill-messages.js";

type Session = Awaited<ReturnType<ExtensionSessionVault["readSession"]>>;
export async function backfillSessionIdentity(session: Session): Promise<string> {
  if (session === null) return "local";
  if (
    !Number.isFinite(Date.parse(session.expiresAt)) ||
    Date.parse(session.expiresAt) <= Date.now()
  )
    throw new BackfillError("authentication");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session.token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function backfillStoredView(
  state: BackfillStorage,
  scope: string,
  identity = "local",
): BackfillView {
  const cloud = scope === "local" ? null : state.scopes[scope];
  if (scope !== "local" && !cloud) throw new BackfillError("unavailable");
  const progress = cloud?.progress ?? state.localProgress;
  const checkError =
    state.initializationError?.tokenHash === identity
      ? backfillErrorResponse(new BackfillError(state.initializationError.code)).error
      : progress.checkError;
  return {
    status: cloud?.status ?? {
      ...backfillStatus(state.local),
      enabled: state.localEnabled && state.migratedTo === null,
      dailyHour: 8,
      revision: state.localRevision,
      scopeId: "local",
      lastCheckedAt: progress.lastCheckedAt,
    },
    shared: cloud != null,
    needsLocalMerge: cloud != null && !cloud.adopted,
    localMergeBlocked: cloud != null && state.migratedTo !== null && state.migratedTo !== scope,
    reconnectRequired: cloud == null && state.migratedTo !== null,
    checkError,
    incomplete: progress.incomplete,
    lastCheckedAt: progress.lastCheckedAt,
    initializing: false,
    checking:
      (cloud?.status.enabled ?? state.localEnabled) &&
      state.initializationError?.tokenHash !== identity &&
      (progress.checking || (progress.forceRequested && !checkError)),
  };
}
export async function readBackfillSnapshot(options: {
  session: Pick<ExtensionSessionVault, "readSession">;
  vault: Pick<ReturnType<typeof createBackfillVault>, "read">;
}): Promise<BackfillView> {
  const before = await options.session.readSession();
  const identity = await backfillSessionIdentity(before);
  const state = await options.vault.read();
  const after = await options.session.readSession();
  if (identity !== (await backfillSessionIdentity(after)))
    throw new BackfillError("authentication");
  if (before === null) return backfillStoredView(state, "local");
  const binding = state.sessionBinding;
  if (binding?.tokenHash === identity && state.scopes[binding.scope])
    return backfillStoredView(state, binding.scope, identity);
  return {
    status: {
      scopeId: "initializing",
      enabled: false,
      dailyHour: 8,
      revision: 0,
      pendingCount: 0,
      unresolvedCount: 0,
      unknownCount: 0,
      lastCheckedAt: null,
    },
    shared: true,
    needsLocalMerge: false,
    localMergeBlocked: false,
    reconnectRequired: false,
    checkError:
      state.initializationError?.tokenHash === identity
        ? backfillErrorResponse(new BackfillError(state.initializationError.code)).error
        : null,
    incomplete: false,
    lastCheckedAt: null,
    initializing: true,
    checking: false,
  };
}
