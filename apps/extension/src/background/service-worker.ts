import type { HostWorkRequest } from "@huayi/protocol";

import { parseContentCommand } from "../shared/extension-messages.js";
import { ChromeNativeTransport } from "./native-transport.js";
import { RequestCoordinator } from "./request-coordinator.js";

export interface RequestCoordinatorLike {
  cancel(tabId: number, requestId: string): boolean;
  start(tabId: number, request: HostWorkRequest): void;
}

export interface RuntimeMessageSender {
  tab?: { id?: number | undefined } | undefined;
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

  if (command.type === "CANCEL_REQUEST") {
    coordinator.cancel(tabId, command.requestId);
  } else {
    coordinator.start(tabId, command.request);
  }
  return true;
}

export function createRuntimeMessageListener(
  coordinator: RequestCoordinatorLike,
): RuntimeMessageListener {
  return (message, sender, sendResponse) => {
    const handled = handleContentMessage(message, sender.tab?.id, coordinator);
    sendResponse({ handled });
    return false;
  };
}

export function registerServiceWorker(): () => void {
  const transport = new ChromeNativeTransport();
  const coordinator = new RequestCoordinator({
    sendToTab: async (tabId, event) => {
      await chrome.tabs.sendMessage(tabId, event);
    },
    transport,
  });
  const listener = createRuntimeMessageListener(coordinator);

  chrome.runtime.onMessage.addListener(listener);
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
    coordinator.dispose();
    transport.dispose();
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.id !== undefined) {
  registerServiceWorker();
}
