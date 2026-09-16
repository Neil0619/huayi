import type { BackfillContext, createBackfillAuthority } from "./backfill-authority.js";
import { backfillMessageSchema, type BackfillView } from "./backfill-messages.js";
import { backfillBadge, discoverBackfillSources } from "./backfill-discovery.js";
import { handleBackfillPage } from "./backfill-page-handler.js";
import { isBackfillPageReview } from "./backfill-page-review.js";
import { BackfillError, backfillErrorResponse } from "./backfill-errors.js";
import { BackfillDiscoveryError } from "./backfill-discovery-errors.js";
import { backfillStoredView } from "./backfill-snapshot.js";
import { SHANBAY_COLLECTION_URL } from "../service-worker/shanbay-message-handler.js";

export function createBackfillRuntime(options: {
  authority: ReturnType<typeof createBackfillAuthority>;
  discovery: Parameters<typeof discoverBackfillSources>[1];
  runtimeId: string;
  allowPage(): Promise<boolean>;
  grantConsent(): Promise<void>;
  openTab(): Promise<number>;
  activateTab(tabId: number, view?: "review"): Promise<void>;
  setBadge(text: string): Promise<void>;
  scheduleMore(delayInMinutes?: number): void | Promise<void>;
}) {
  const view = (context: BackfillContext): BackfillView =>
    backfillStoredView(context.state, context.scope, context.identity);
  const badge = async (context: BackfillContext) => {
    await context.assertCurrent();
    const state = view(context);
    await options.setBadge(
      backfillBadge(
        state.status.enabled ? state.status.pendingCount : 0,
        state.status.enabled &&
          (state.status.unresolvedCount > 0 ||
            state.status.unknownCount > 0 ||
            !!state.checkError ||
            state.incomplete),
      ),
    );
  };
  let running: Promise<void> | null = null;
  let activeLocalOnly = false;
  let followup: "local" | "full" | null = null;
  const queueFollowup = (localOnly: boolean) => {
    if (!localOnly || followup === null) followup = localOnly ? "local" : "full";
  };
  const refresh = (localOnly = false): Promise<void> => {
    if (running) {
      // A local save may arrive after the active pass took its lexicon snapshot.
      // One durable continuation observes all such saves without queuing scans.
      if (localOnly || activeLocalOnly) {
        queueFollowup(localOnly);
        const active = running;
        return Promise.resolve(options.scheduleMore(0.5)).then(() => active);
      }
      return running;
    }
    activeLocalOnly = localOnly;
    running = (async () => {
      // A periodic durable wakeup also recovers interrupted source reads and pending writes.
      await options.scheduleMore(15);
      try {
        const more = await discoverBackfillSources(options.authority, {
          ...options.discovery,
          localOnly,
        });
        const queued = await options.authority.run(
          async (context) => context.progress.forceRequested,
          true,
        );
        if (more || queued) await options.scheduleMore(0.5);
        await options.authority.run(badge, true);
      } catch (error) {
        if (error instanceof BackfillDiscoveryError) {
          await options.authority.run(badge, true).catch(() => options.setBadge("!"));
        } else await options.setBadge("!");
      }
    })().finally(() => {
      running = null;
      // Only explicit requests arriving during this pass create an immediate follow-up.
      // Remaining source pages use the durable alarm and cannot create a self-loop.
      const next = followup;
      followup = null;
      if (next !== null) void refresh(next === "local").catch(() => options.setBadge("!"));
    });
    return running;
  };
  const requesting = new Map<string, Promise<void>>();
  const requestScan = async (expectedScope: string, force: boolean): Promise<void> => {
    const identity = await options.authority.readIdentity();
    const key = `${identity}:${expectedScope}`;
    const existing = requesting.get(key);
    if (existing) return existing;
    const request = (async () => {
      await options.authority.run(async (context) => {
        if (context.scope !== expectedScope || context.identity !== identity)
          throw new BackfillError("authentication");
        context.progress.forceRequested ||= force;
        context.progress.checking = context.status().enabled;
      }, true);
      await options.scheduleMore(0.5);
      if (running) queueFollowup(false);
      void refresh().catch(() => options.setBadge("!"));
    })().finally(() => {
      requesting.delete(key);
    });
    requesting.set(key, request);
    return request;
  };
  const snapshot = async (expectedScope?: string) => {
    const saved = await options.authority.readSnapshot();
    if (
      expectedScope !== undefined &&
      (saved.initializing || saved.status.scopeId !== expectedScope)
    )
      throw new BackfillError("authentication");
    return saved;
  };
  return {
    refresh,
    async handle(
      value: unknown,
      sender: {
        id?: string | undefined;
        url?: string | undefined;
        tab?: { id?: number | undefined } | undefined;
        documentId?: string | undefined;
        frameId?: number | undefined;
      },
    ) {
      const message = backfillMessageSchema.parse(value);
      const fromPage =
        isBackfillPageReview(message) ||
        [
          "store/backfill-page-ready",
          "store/backfill-resolve",
          "store/backfill-renew",
          "store/backfill-unknown",
        ].includes(message.type);
      if (sender.id !== options.runtimeId) return undefined;
      if (fromPage) {
        if (
          sender.frameId !== 0 ||
          sender.url !== SHANBAY_COLLECTION_URL ||
          !(await options.allowPage())
        )
          return undefined;
      } else if (
        (sender.url !== `chrome-extension://${options.runtimeId}/options.html` &&
          sender.url !== `chrome-extension://${options.runtimeId}/popup.html`) ||
        (sender.frameId !== undefined && sender.frameId !== 0)
      )
        return undefined;
      let errorBadgeHandled = false;
      try {
        if (message.type === "store/backfill-status") return await snapshot();
        if (message.type === "store/backfill-initialize") {
          await options.scheduleMore(0.5);
          if (running) queueFollowup(false);
          void refresh().catch(() => options.setBadge("!"));
          return await snapshot();
        }
        if (message.type === "store/backfill-check") {
          await snapshot(message.expectedScope);
          await requestScan(message.expectedScope, true);
          return await snapshot(message.expectedScope);
        }
        let openedTab: number | null = null;
        if (message.type === "store/backfill-open") {
          const saved = await snapshot(message.expectedScope);
          if (!saved.status.enabled || saved.needsLocalMerge || saved.reconnectRequired)
            throw new BackfillError("unavailable");
          if (!(await options.allowPage())) throw new BackfillError("permission");
          await snapshot(message.expectedScope);
          if (!(await options.allowPage())) throw new BackfillError("permission");
          openedTab = await options.openTab();
        }
        const response = await options.authority.run(
          async (context) => {
            try {
              if ("expectedScope" in message && message.expectedScope !== context.scope)
                throw new Error("账号已变化，请刷新回填状态后重试。");
              if (fromPage) {
                if (!(await options.allowPage())) return undefined;
                const response = await handleBackfillPage(context, message, sender);
                await badge(context);
                return response;
              }
              switch (message.type) {
                case "store/backfill-enable":
                  if (message.enabled && view(context).reconnectRequired)
                    throw new Error("本机进度已共享，请连接原账号后继续。");
                  if (message.enabled && message.shareLocal && view(context).localMergeBlocked)
                    throw new Error("原账号的本机历史不能迁入当前账号，请刷新后重新开启。");
                  if (message.enabled) await options.grantConsent();
                  await context.command({
                    action: "settings",
                    enabled: message.enabled,
                    dailyHour: 8,
                    expectedRevision: context.status().revision,
                  });
                  if (!message.enabled) {
                    context.progress.forceRequested = false;
                    context.progress.checking = false;
                  }
                  if (message.enabled && context.shared) {
                    if (message.shareLocal) await context.adopt();
                    else {
                      const scope = context.state.scopes[context.scope];
                      if (scope && !scope.adopted) {
                        scope.localExcluded = (await options.discovery.lexicon.snapshot()).map(
                          (entry) => entry.headword,
                        );
                        scope.adopted = true;
                      }
                    }
                  }

                  break;
                case "store/backfill-open": {
                  if (!(await options.allowPage())) throw new BackfillError("permission");
                  if (
                    !context.status().enabled ||
                    (context.shared && !context.state.scopes[context.scope]?.adopted)
                  )
                    throw new Error("请先开启扇贝回填并确认数据范围。");
                  if (!(await options.allowPage())) throw new BackfillError("permission");
                  await context.assertCurrent();
                  const tabId = openedTab;
                  if (tabId === null) throw new BackfillError("unavailable");
                  if (
                    context.state.page?.tabId !== tabId ||
                    context.state.page.scope !== context.scope
                  )
                    context.state.page = {
                      scope: context.scope,
                      tabId,
                      documentId: null,
                      batch: null,
                    };
                  context.state.page.reviewRequested = message.view === "review";
                  context.state.page.review = null;
                  await context.persist();
                  await context.assertCurrent();
                  if (message.view) await options.activateTab(tabId, message.view);
                  else await options.activateTab(tabId);
                  break;
                }
                case "store/backfill-unresolved":
                  return context.unresolved(message.cursor);
                case "store/backfill-replace":
                  await context.command({
                    action: "replace",
                    source: message.source,
                    target: message.target,
                    expectedRevision: message.revision,
                  });
                  break;
                case "store/backfill-discard":
                  await context.command({
                    action: "discard",
                    source: message.source,
                    expectedRevision: message.revision,
                  });
                  break;
                case "store/backfill-retry-unknown":
                  await context.command({ action: "retry-unknown", token: message.token });
                  break;
              }
              await badge(context);
              return view(context);
            } catch (error) {
              await badge(context);
              errorBadgeHandled = true;
              throw error;
            }
          },
          isBackfillPageReview(message) && message.type !== "store/backfill-page-review",
        );
        if (message.type === "store/backfill-enable" && message.enabled) {
          await requestScan(message.expectedScope, true);
          return await snapshot(message.expectedScope);
        }
        return response;
      } catch (error) {
        if (!errorBadgeHandled) await options.setBadge("!");
        return backfillErrorResponse(error);
      }
    },
  };
}
