import type { AnalysisError, WordSyncRequest, WordSyncStatusEvent } from "@huayi/protocol";

import type { ShanbayBackgroundMessage } from "../shared/extension-messages.js";
import type { NativeDisconnect, NativeTransport } from "./native-transport.js";
import { wordSyncFailurePresentation } from "./word-sync-presentation.js";

export interface WordSyncBrowserApi {
  createAlarm(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): void;
  clearAlarm?(name: string): Promise<boolean> | undefined;
  getAlarm(name: string): Promise<chrome.alarms.Alarm | undefined>;
  createTab(url: string): Promise<void> | void;
  sendToTab(tabId: number, message: ShanbayBackgroundMessage): Promise<void> | void;
  setBadgeText(text: string): Promise<void> | void;
  setTitle(title: string): Promise<void> | void;
}

export interface WordSyncCoordinatorOptions {
  browser: WordSyncBrowserApi;
  createRequestId?: () => string;
  now?: () => Date;
  timeoutMs?: number;
  transport: NativeTransport;
}

export interface WordSyncRuntimeSettings {
  automaticSync: boolean;
  enabled: boolean;
  syncHour: number;
}

export const DEFAULT_WORD_SYNC_TIMEOUT_MS = 65_000;

export type PendingKind =
  | "action-prepare"
  | "discard-all-unresolved"
  | "discard-unresolved"
  | "list-unresolved"
  | "poll"
  | "requeue-unresolved"
  | "resolve"
  | "status"
  | "tab-prepare";

export type PreparePendingKind = "action-prepare" | "tab-prepare";

export interface PendingSyncRequest {
  kind: PendingKind;
  request: WordSyncRequest;
  resumePrepareKind?: PreparePendingKind;
  tabId?: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

export function attachPrepareToPendingPoll(
  pendingRequests: Iterable<PendingSyncRequest>,
  resumePrepareKind: PreparePendingKind | undefined,
  tabId: number | undefined,
): boolean {
  const pending = [...pendingRequests].find((request) => request.kind === "poll");
  if (pending === undefined) return false;
  if (
    resumePrepareKind === "tab-prepare" ||
    (resumePrepareKind !== undefined && pending.resumePrepareKind === undefined)
  ) {
    pending.resumePrepareKind = resumePrepareKind;
    if (tabId === undefined) delete pending.tabId;
    else pending.tabId = tabId;
  }
  return true;
}

export function acceptsWordSyncStatus(kind: PendingKind): boolean {
  return (
    kind === "status" || kind === "poll" || kind === "action-prepare" || kind === "tab-prepare"
  );
}

export function ignoreBrowserFailure(result: Promise<void> | void): void {
  if (result !== undefined) void result.catch(() => undefined);
}

export function hostUnavailableError(disconnect: NativeDisconnect): AnalysisError {
  return {
    code: disconnect.reason === "invalid-message" ? "INVALID_RESPONSE" : "HOST_NOT_INSTALLED",
    message:
      disconnect.reason === "invalid-message"
        ? "本机服务返回了无效数据。"
        : "无法连接划译本机服务，请确认已经安装并与扩展同步升级。",
    retryable: disconnect.reason !== "invalid-message",
  };
}

export function updateWordSyncStatusCounts(
  status: WordSyncStatusEvent | null,
  pendingCount: number,
  unresolvedCount: number,
): WordSyncStatusEvent | null {
  if (status === null) return null;
  return { ...status, pendingCount, unresolvedCount };
}

export function finishPendingSync(
  pendingRequests: Map<string, PendingSyncRequest>,
  pending: PendingSyncRequest,
): void {
  clearTimeout(pending.timeoutId);
  pendingRequests.delete(pending.request.requestId);
}

export function presentWordSyncFailure(
  browser: WordSyncBrowserApi,
  lastStatus: WordSyncStatusEvent | null,
  pending: PendingSyncRequest,
  error: AnalysisError,
): void {
  const presentation = wordSyncFailurePresentation(lastStatus, error);
  ignoreBrowserFailure(browser.setBadgeText(presentation.badge));
  ignoreBrowserFailure(browser.setTitle(presentation.title));
  if (pending.tabId !== undefined) {
    ignoreBrowserFailure(browser.sendToTab(pending.tabId, { error, type: "SHANBAY_SYNC_ERROR" }));
  }
}

export function recoverWordSyncPollFailure(
  browser: WordSyncBrowserApi,
  pending: PendingSyncRequest,
  error: AnalysisError,
  requestStatus: () => void,
): void {
  if (pending.kind !== "poll") return;
  if (error.retryable) browser.createAlarm("huayi-word-sync-continue", { delayInMinutes: 1 });
  requestStatus();
}
