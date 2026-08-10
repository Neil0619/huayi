import type { HostWorkRequest, WordSyncRequeueUnresolvedRequest } from "@huayi/protocol";

import {
  parseContentCommand,
  parseSettingsPageCommand,
  parseShanbayCommand,
} from "../shared/extension-messages.js";
import { evaluatePageAccess, type ExtensionSettings } from "../settings/settings-domain.js";
import { SettingsStore } from "../settings/settings-store.js";
import { ChromeNativeTransport } from "./native-transport.js";
import { HostSettingsCoordinator } from "./host-settings-coordinator.js";
import { SettingsCoordinator } from "./settings-coordinator.js";
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

export interface HostSettingsCoordinatorLike {
  selectProvider(
    provider: Parameters<HostSettingsCoordinator["selectProvider"]>[0],
  ): ReturnType<HostSettingsCoordinator["selectProvider"]>;
  status(): ReturnType<HostSettingsCoordinator["status"]>;
}

export interface SettingsCoordinatorLike {
  mutate: SettingsCoordinator["mutate"];
}

export interface WordSyncCoordinatorLike {
  discardAllUnresolved(tabId: number): void;
  discardUnresolved(tabId: number, sourceWords: readonly string[]): void;
  handlePageReady(tabId: number): void;
  handleStartup(): void;
  listUnresolved(tabId: number, offset: number): void;
  requeueUnresolved(tabId: number, items: WordSyncRequeueUnresolvedRequest["items"]): void;
  resolveBatch(tabId: number, batchId: string, rejectedTargets: readonly string[]): void;
  startManualSync?(): boolean;
}

export type RuntimeMessageListener = (
  message: unknown,
  sender: RuntimeMessageSender,
  sendResponse: (response: unknown) => void,
) => boolean;

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
  hostSettingsCoordinator?: HostSettingsCoordinatorLike,
  settingsCoordinator?: SettingsCoordinatorLike,
  extensionOrigin?: string,
  contentAllowed?: (sender: RuntimeMessageSender) => boolean,
): RuntimeMessageListener {
  return (message, sender, sendResponse) => {
    const settingsCommand = parseSettingsPageCommand(message);
    if (
      settingsCommand !== null &&
      sender.url !== undefined &&
      extensionOrigin !== undefined &&
      sender.url.startsWith(extensionOrigin)
    ) {
      if (settingsCommand.type === "MUTATE_SETTINGS") {
        if (settingsCoordinator === undefined) {
          sendResponse({ handled: false });
          return false;
        }
        void settingsCoordinator.mutate(settingsCommand.mutation).then(
          (settings) => sendResponse({ event: settings, handled: true }),
          (error: unknown) =>
            sendResponse({
              error: error instanceof Error ? error.message : "设置保存失败。",
              handled: false,
            }),
        );
        return true;
      }
      if (settingsCommand.type === "START_WORD_SYNC") {
        const handled =
          wordSyncCoordinator?.startManualSync === undefined
            ? false
            : wordSyncCoordinator.startManualSync();
        sendResponse({ handled });
        return false;
      }
      const operation =
        settingsCommand.type === "GET_HOST_SETTINGS"
          ? hostSettingsCoordinator?.status()
          : hostSettingsCoordinator?.selectProvider(settingsCommand.provider);
      if (operation === undefined) {
        sendResponse({ handled: false });
        return false;
      }
      void operation.then(
        (event) => sendResponse({ event, handled: true }),
        (error: unknown) =>
          sendResponse({
            error: error instanceof Error ? error.message : "本机配置请求失败。",
            handled: false,
          }),
      );
      return true;
    }
    const contentCommand = parseContentCommand(message);
    const mayHandleContent =
      contentCommand?.type === "CANCEL_REQUEST" || contentAllowed?.(sender) !== false;
    const handled =
      (mayHandleContent && handleContentMessage(message, sender.tab?.id, coordinator)) ||
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
  const hostSettingsCoordinator = new HostSettingsCoordinator({ transport });
  const settingsCoordinator = new SettingsCoordinator();
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
      clearAlarm: async (name) => await chrome.alarms.clear(name),
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
  const settingsStore = new SettingsStore();
  let currentSettings: ExtensionSettings | null = null;
  const contentAllowed = (sender: RuntimeMessageSender): boolean => {
    if (sender.url === undefined || currentSettings === null) return false;
    try {
      return evaluatePageAccess(new URL(sender.url), currentSettings) === "allow";
    } catch {
      return false;
    }
  };
  const listener = createRuntimeMessageListener(
    coordinator,
    wordSyncCoordinator,
    hostSettingsCoordinator,
    settingsCoordinator,
    chrome.runtime.getURL(""),
    contentAllowed,
  );
  const tabRemovedListener = (tabId: number) => coordinator.cancelTab(tabId);
  const alarmListener = (alarm: chrome.alarms.Alarm) => wordSyncCoordinator.handleAlarm(alarm.name);
  const startupListener = () => wordSyncCoordinator.handleStartup();

  chrome.runtime.onMessage.addListener(listener);
  chrome.tabs.onRemoved.addListener(tabRemovedListener);
  chrome.alarms.onAlarm.addListener(alarmListener);
  chrome.runtime.onStartup.addListener(startupListener);
  let settingsRevision = 0;
  const unsubscribeSettings = settingsStore.subscribe((parsed) => {
    settingsRevision += 1;
    currentSettings = parsed.settings;
    wordSyncCoordinator.configure(parsed.settings.wordbook);
  });
  const initialSettingsRevision = settingsRevision;
  void settingsStore.read().then(
    (parsed) => {
      if (settingsRevision !== initialSettingsRevision) return;
      currentSettings = parsed.settings;
      wordSyncCoordinator.initialize(parsed.settings.wordbook);
    },
    () => {
      if (settingsRevision === initialSettingsRevision) {
        wordSyncCoordinator.initialize({ automaticSync: false, enabled: false, syncHour: 8 });
      }
    },
  );
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
    chrome.tabs.onRemoved.removeListener(tabRemovedListener);
    chrome.alarms.onAlarm.removeListener(alarmListener);
    chrome.runtime.onStartup.removeListener(startupListener);
    wordSyncCoordinator.dispose();
    unsubscribeSettings();
    hostSettingsCoordinator.dispose();
    coordinator.dispose();
    transport.dispose();
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.id !== undefined) {
  registerServiceWorker();
}
