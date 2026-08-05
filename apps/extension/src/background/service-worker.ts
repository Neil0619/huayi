import type { HostWorkRequest, WordSyncRequeueUnresolvedRequest } from "@huayi/protocol";

import { parseContentCommand, parseShanbayCommand } from "../shared/extension-messages.js";
import { ChromeNativeTransport } from "./native-transport.js";
import { RequestCoordinator } from "./request-coordinator.js";
import { WordSyncCoordinator } from "./word-sync-coordinator.js";

export interface RequestCoordinatorLike {
  cancel(tabId: number, requestId: string): boolean;
  cancelTab(tabId: number): void;
  start(tabId: number, request: HostWorkRequest): void;
  warmup(): void;
}

export interface RuntimeMessageSender {
  url?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
}

export interface WordSyncCoordinatorLike {
  discardAllUnresolved(tabId: number): void;
  discardUnresolved(tabId: number, sourceWords: readonly string[]): void;
  handlePageReady(tabId: number): void;
  handleStartup(): void;
  listUnresolved(tabId: number, offset: number): void;
  requeueUnresolved(tabId: number, items: WordSyncRequeueUnresolvedRequest["items"]): void;
  resolveBatch(tabId: number, batchId: string, rejectedTargets: readonly string[]): void;
}

export type RuntimeMessageListener = (
  message: unknown,
  sender: RuntimeMessageSender,
  sendResponse: (response: { handled: boolean }) => void,
) => false;

export function handleContentMessage(
  message: unknown,
  tabId: number | undefined,
  coordinator: RequestCoordinatorLike,
): boolean {
  if (tabId === undefined) {
    return false;
  }

  const command = parseContentCommand(message);
  if (command === null) {
    return false;
  }

  if (command.type === "WARMUP_HOST") {
    coordinator.warmup();
  } else if (command.type === "CANCEL_REQUEST") {
    coordinator.cancel(tabId, command.requestId);
  } else {
    coordinator.start(tabId, command.request);
  }
  return true;
}

export function createRuntimeMessageListener(
  coordinator: RequestCoordinatorLike,
  wordSyncCoordinator?: WordSyncCoordinatorLike,
): RuntimeMessageListener {
  return (message, sender, sendResponse) => {
    const handled =
      handleContentMessage(message, sender.tab?.id, coordinator) ||
      handleShanbayMessage(message, sender, wordSyncCoordinator);
    sendResponse({ handled });
    return false;
  };
}

export function handleShanbayMessage(
  message: unknown,
  sender: RuntimeMessageSender,
  coordinator: WordSyncCoordinatorLike | undefined,
): boolean {
  const tabId = sender.tab?.id;
  if (coordinator === undefined || tabId === undefined || sender.url === undefined) return false;
  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    return false;
  }
  if (
    url.origin !== "https://web.shanbay.com" ||
    url.pathname !== "/wordsweb/" ||
    url.hash !== "#/collection"
  ) {
    return false;
  }
  const command = parseShanbayCommand(message);
  if (command === null) return false;
  switch (command.type) {
    case "SHANBAY_PAGE_READY":
      coordinator.handlePageReady(tabId);
      break;
    case "RESOLVE_SHANBAY_BATCH":
      coordinator.resolveBatch(tabId, command.batchId, command.rejectedTargets);
      break;
    case "LIST_SHANBAY_UNRESOLVED":
      coordinator.listUnresolved(tabId, command.offset);
      break;
    case "REQUEUE_SHANBAY_UNRESOLVED":
      coordinator.requeueUnresolved(tabId, command.items);
      break;
    case "DISCARD_SHANBAY_UNRESOLVED":
      coordinator.discardUnresolved(tabId, command.sourceWords);
      break;
    case "DISCARD_ALL_SHANBAY_UNRESOLVED":
      coordinator.discardAllUnresolved(tabId);
      break;
  }
  return true;
}

export function registerServiceWorker(): () => void {
  const transport = new ChromeNativeTransport();
  const coordinator = new RequestCoordinator({
    sendToTab: async (tabId, event) => {
      await chrome.tabs.sendMessage(tabId, event);
    },
    transport,
  });
  const wordSyncCoordinator = new WordSyncCoordinator({
    browser: {
      createAlarm: (name, alarmInfo) => {
        void chrome.alarms.create(name, alarmInfo);
      },
      getAlarm: async (name) => await chrome.alarms.get(name),
      createTab: async (url) => {
        await chrome.tabs.create({ url });
      },
      sendToTab: async (tabId, message) => {
        await chrome.tabs.sendMessage(tabId, message);
      },
      setBadgeText: async (text) => {
        await chrome.action.setBadgeText({ text });
      },
      setTitle: async (title) => {
        await chrome.action.setTitle({ title });
      },
    },
    transport,
  });
  const listener = createRuntimeMessageListener(coordinator, wordSyncCoordinator);
  const tabRemovedListener = (tabId: number) => coordinator.cancelTab(tabId);
  const actionClickListener = () => wordSyncCoordinator.handleActionClick();
  const alarmListener = (alarm: chrome.alarms.Alarm) => wordSyncCoordinator.handleAlarm(alarm.name);
  const startupListener = () => wordSyncCoordinator.handleStartup();

  chrome.runtime.onMessage.addListener(listener);
  chrome.tabs.onRemoved.addListener(tabRemovedListener);
  chrome.action.onClicked.addListener(actionClickListener);
  chrome.alarms.onAlarm.addListener(alarmListener);
  chrome.runtime.onStartup.addListener(startupListener);
  wordSyncCoordinator.initialize();
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
    chrome.tabs.onRemoved.removeListener(tabRemovedListener);
    chrome.action.onClicked.removeListener(actionClickListener);
    chrome.alarms.onAlarm.removeListener(alarmListener);
    chrome.runtime.onStartup.removeListener(startupListener);
    wordSyncCoordinator.dispose();
    coordinator.dispose();
    transport.dispose();
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.id !== undefined) {
  registerServiceWorker();
}
