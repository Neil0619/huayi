import {
  backfillStatus,
  backfillReviewBatches,
  discardAllBackfillReview,
  discardBackfillUnknown,
  claimBackfillBatch,
  discardBackfillSource,
  discardAllBackfillUnresolved,
  expireBackfillBatches,
  findBackfillLemma,
  markBackfillUnknown,
  renewBackfillBatch,
  replaceBackfillSource,
  resolveBackfillBatch,
  retryBackfillUnknown,
  discoverBackfill,
} from "@huayi/store-domain";
import type {
  ShanbayBackfillCommand,
  ShanbayBackfillResponse,
  ShanbayBackfillUnresolved,
} from "@huayi/cloud-contracts";
import type { ExtensionSessionVault } from "../service-worker/extension-session-vault.js";
import {
  initialBackfillProgress,
  type BackfillStorage,
  type createBackfillVault,
} from "./backfill-vault.js";
import type { createBackfillCloudApi } from "./backfill-cloud-api.js";
import { BackfillCloudError } from "./backfill-cloud-api.js";
import { BackfillError } from "./backfill-errors.js";
import { backfillSessionIdentity, readBackfillSnapshot } from "./backfill-snapshot.js";

export interface BackfillContext {
  state: BackfillStorage;
  scope: string;
  identity: string;
  shared: boolean;
  progress: BackfillStorage["localProgress"];
  persist(): Promise<void>;
  assertCurrent(): Promise<void>;
  status(): ShanbayBackfillResponse["status"];
  command(command: ShanbayBackfillCommand): Promise<ShanbayBackfillResponse>;
  unresolved(cursor?: string): Promise<ShanbayBackfillUnresolved>;
  adopt(): Promise<void>;
}
export function createBackfillAuthority(options: {
  vault: ReturnType<typeof createBackfillVault>;
  session: Pick<ExtensionSessionVault, "readSession">;
  api: ReturnType<typeof createBackfillCloudApi> | null;
  lock: <T>(operation: () => Promise<T>) => Promise<T>;
}) {
  return {
    readSnapshot: () => readBackfillSnapshot(options),
    readIdentity: async () => backfillSessionIdentity(await options.session.readSession()),
    run: <T>(operation: (context: BackfillContext) => Promise<T>, cached = false): Promise<T> =>
      options.lock(async () => {
        const state = await options.vault.read();
        const session = await options.session.readSession();
        const identity = await backfillSessionIdentity(session);
        const persist = () => options.vault.write(state);
        const assertCurrent = async () => {
          const live = await options.session.readSession();
          if ((live?.token ?? null) !== (session?.token ?? null))
            throw new BackfillError("authentication");
          if (live && Date.parse(live.expiresAt) <= Date.now())
            throw new BackfillError("authentication");
        };
        let scope = "local";
        if (session !== null) {
          if (Date.parse(session.expiresAt) <= Date.now())
            throw new BackfillError("authentication");
          const binding = state.sessionBinding;
          let remote;
          try {
            if (cached) {
              if (binding && binding.tokenHash !== identity)
                throw new BackfillError("authentication");
              if (binding?.tokenHash !== identity || !state.scopes[binding.scope])
                throw new BackfillError("unavailable");
              remote = state.scopes[binding.scope]?.status;
              if (!remote) throw new BackfillError("unavailable");
            } else {
              if (!options.api) throw new BackfillError("unavailable");
              remote = await options.api.status(session.token);
            }
            if (
              ["local", "initializing", "__proto__", "constructor", "prototype"].includes(
                remote.scopeId,
              )
            )
              throw new BackfillError("authentication");
          } catch (error) {
            await assertCurrent();
            if (!cached) {
              state.initializationError = {
                tokenHash: identity,
                code: error instanceof BackfillError ? error.code : "request-failed",
              };
              if (error instanceof BackfillError && error.code === "authentication")
                state.sessionBinding = null;
              await persist();
            }
            throw error;
          }
          await assertCurrent();
          scope = remote.scopeId;
          state.sessionBinding = { tokenHash: identity, scope };
          if (!cached) state.initializationError = null;
          if (!Object.hasOwn(state.scopes, scope))
            state.scopes[scope] = {
              status: remote,
              progress: initialBackfillProgress(),
              adopted: false,
              localExcluded: [],
              adoptIndex: 0,
              adoptPhase: "evidence",
              pending: null,
            };
          const account = state.scopes[scope];
          if (account) account.status = remote;
        }
        if (state.activeScope !== scope) {
          state.page = null;
          state.activeScope = scope;
        }
        expireBackfillBatches(state.local, new Date().toISOString());
        const cloud = scope === "local" ? null : state.scopes[scope];
        if (scope !== "local" && !cloud) throw new Error("回填账号状态不可用。");
        const currentStatus = () =>
          cloud?.status ?? {
            ...backfillStatus(state.local),
            enabled: state.localEnabled && state.migratedTo === null,
            dailyHour: 8,
            revision: state.localRevision,
            scopeId: "local",
            lastCheckedAt: state.localProgress.lastCheckedAt,
          };
        const send = async (command: ShanbayBackfillCommand): Promise<ShanbayBackfillResponse> => {
          await assertCurrent();
          if (!cloud) return applyLocal(state, command);
          if (!session || !options.api) throw new Error("云端连接不可用。");
          const api = options.api;
          const live = await options.session.readSession();
          if (live?.token !== session.token) throw new BackfillError("authentication");
          const submit = async (key: string, input: ShanbayBackfillCommand) => {
            try {
              const response = await api.command(session.token, key, input);
              await assertCurrent();
              if (response.status.scopeId !== scope) throw new BackfillError("authentication");
              return response;
            } catch (error) {
              if (error instanceof BackfillError && error.code === "authentication") {
                state.sessionBinding = null;
                state.initializationError = { tokenHash: identity, code: "authentication" };
              }
              if (error instanceof BackfillCloudError && error.permanent) {
                cloud.pending = null;
                await persist();
              }
              throw error;
            }
          };
          if (cloud.pending) {
            const previous = cloud.pending;
            const response = await submit(previous.key, previous.command);
            cloud.status = response.status;
            cloud.pending = null;
            await persist();
            if (JSON.stringify(previous.command) === JSON.stringify(command)) return response;
            if (previous.command.action === "claim" && response.batch)
              await send({ action: "unknown", token: response.batch.token });
            if (
              previous.command.action === "resolve" &&
              response.accepted &&
              state.page?.batch?.token === previous.command.token
            )
              state.page.batch = null;
          }
          cloud.pending = { key: crypto.randomUUID(), command };
          await persist();
          const response = await submit(cloud.pending.key, command);
          cloud.status = response.status;
          cloud.pending = null;
          await persist();
          return response;
        };
        const context: BackfillContext = {
          state,
          scope,
          identity,
          shared: cloud != null,
          progress: cloud?.progress ?? state.localProgress,
          persist,
          assertCurrent,
          status: currentStatus,
          command: async (command) => {
            const response = await send(command);
            await persist();
            return response;
          },
          unresolved: async (cursor) => {
            await assertCurrent();
            if (cloud && options.api && session)
              return options.api.unresolved(session.token, cursor);
            const entries = [
              ...Object.values(state.local.sources)
                .filter((source) => source.state === "unresolved")
                .map((source) => ({ key: `s:${source.headword}`, source })),
              ...backfillReviewBatches(state.local).map((batch) => ({
                key: `b:${batch.token}`,
                batch,
              })),
            ]
              .sort((a, b) => (a.key < b.key ? -1 : 1))
              .filter((item) => cursor === undefined || item.key > cursor);
            const page = entries.slice(0, 100);
            return {
              items: page.flatMap((item) => ("source" in item ? [item.source] : [])),
              unknownBatches: page.flatMap((item) =>
                "batch" in item
                  ? [{ token: item.batch.token, headwords: item.batch.headwords }]
                  : [],
              ),
              nextCursor: entries.length > 100 ? (page.at(-1)?.key ?? null) : null,
              revision: state.localRevision,
            };
          },
          adopt: async () => {
            if (!cloud || cloud.adopted) return;
            if (state.migratedTo !== null && state.migratedTo !== scope)
              throw new Error("本机历史已合并到另一个账号，不会迁入当前账号。");
            state.migratedTo = scope;
            state.page = null;
            await persist();
            const sources = Object.values(state.local.sources).sort((a, b) =>
              a.headword < b.headword ? -1 : 1,
            );
            const confirmed = Object.values(state.local.targets)
              .filter((target) => target.confirmedAt !== null)
              .map((target) => target.headword);
            const dismissed = state.local.batches.flatMap((batch) =>
              batch.state === "unknown" && batch.dismissedAt !== undefined
                ? batch.headwords.map((word) => ({
                    headwords: [word],
                    dismissedAt: batch.dismissedAt as string,
                  }))
                : [],
            );
            const unknown = [
              ...new Set(
                state.local.batches
                  .filter((batch) => batch.state !== "resolved" && batch.dismissedAt === undefined)
                  .flatMap((batch) => batch.headwords),
              ),
            ];
            // Upload confirmations, unknown holds and dismissals before any source is claimable.
            if (cloud.adoptPhase === "evidence") {
              for (
                let index = cloud.adoptIndex;
                index < Math.max(confirmed.length, unknown.length, dismissed.length);
                index += 100
              ) {
                await context.command({
                  action: "adopt",
                  sources: [],
                  confirmed: confirmed.slice(index, index + 100),
                  unknown: unknown.slice(index, index + 100),
                  ...(dismissed.length ? { dismissed: dismissed.slice(index, index + 100) } : {}),
                });
                cloud.adoptIndex = index + 100;
                await persist();
              }
              cloud.adoptIndex = 0;
              cloud.adoptPhase = "sources";
              await persist();
            }
            for (let index = cloud.adoptIndex; index < sources.length; index += 100) {
              await context.command({
                action: "adopt",
                sources: sources.slice(index, index + 100),
                confirmed: [],
                unknown: [],
              });
              cloud.adoptIndex = index + 100;
              await persist();
            }
            cloud.adopted = true;
            await persist();
          },
        };
        await persist();
        try {
          await assertCurrent();
          const result = await operation(context);
          await assertCurrent();
          return result;
        } finally {
          await persist();
        }
      }),
  };
}

function applyLocal(
  state: BackfillStorage,
  command: ShanbayBackfillCommand,
): ShanbayBackfillResponse {
  const now = new Date().toISOString();
  if ("expectedRevision" in command && command.expectedRevision !== state.localRevision)
    throw new Error("回填状态已变化，请刷新后重试。");
  if (!state.localEnabled && command.action !== "settings") throw new Error("请先开启扇贝回填。");
  if (state.migratedTo !== null && command.action === "claim")
    throw new Error("本机进度已共享，请连接原账号后继续。");
  let batch: ShanbayBackfillResponse["batch"] = null;
  let accepted = true;
  switch (command.action) {
    case "settings":
      state.localEnabled = command.enabled;
      break;
    case "discover":
      discoverBackfill(state.local, command.headwords, command.origin, now);
      break;
    case "claim": {
      const claimed = claimBackfillBatch(state.local, {
        holder: "local",
        ...(command.limit === undefined ? {} : { limit: command.limit }),
        now,
        token: crypto.randomUUID(),
      });
      batch = claimed
        ? { token: claimed.token, headwords: claimed.headwords, expiresAt: claimed.expiresAt }
        : null;
      break;
    }
    case "renew":
      accepted = renewBackfillBatch(state.local, { holder: "local", now, token: command.token });
      break;
    case "resolve":
      accepted = resolveBackfillBatch(state.local, {
        ...command,
        holder: "local",
        now,
        findLemma: findBackfillLemma,
      });
      break;
    case "unknown":
      markBackfillUnknown(state.local, command.token, now);
      break;
    case "retry-unknown":
      accepted = retryBackfillUnknown(state.local, command.token, now);
      break;
    case "replace":
      accepted = replaceBackfillSource(state.local, command.source, command.target, now);
      break;
    case "discard-review":
      discardAllBackfillReview(state.local, now);
      break;
    case "discard-unknown":
      accepted = discardBackfillUnknown(state.local, command.token, now);
      break;
    case "discard-unresolved":
      discardAllBackfillUnresolved(state.local, now);
      break;
    case "discard":
      accepted = discardBackfillSource(state.local, command.source, now);
      break;
    default:
      throw new Error("本机模式不支持此操作。");
  }
  state.localRevision += 1;
  return {
    accepted,
    batch,
    nextCursor: null,
    status: {
      ...backfillStatus(state.local),
      enabled: state.localEnabled,
      dailyHour: 8,
      revision: state.localRevision,
      scopeId: "local",
      lastCheckedAt: state.localProgress.lastCheckedAt,
    },
  };
}
