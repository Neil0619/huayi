import type { StoreMessageSender } from "./version-handshake.js";
import { requestVersionHandshake } from "./version-handshake.js";

interface StartableContentApp {
  start(): Promise<void> | void;
}

export type StoreContentStartupExecutor = <T>(operation: () => Promise<T>) => Promise<T>;

export interface StoreContentBootstrapDependencies {
  readonly createApp: () => StartableContentApp;
  readonly createRequestId: () => string;
  readonly runStartupStep?: StoreContentStartupExecutor;
  readonly sendMessage: StoreMessageSender;
}

export async function bootstrapStoreContentScript(
  dependencies: StoreContentBootstrapDependencies,
): Promise<void> {
  try {
    const response = await (dependencies.runStartupStep ?? ((operation) => operation()))(() =>
      requestVersionHandshake(dependencies.sendMessage, dependencies.createRequestId()),
    );
    delete document.documentElement.dataset.huayiStoreUnavailable;
    if (!response.compatible) {
      document.documentElement.dataset.huayiStoreReloadRequired = "true";
      return;
    }
    await dependencies.createApp().start();
  } catch {
    document.documentElement.dataset.huayiStoreUnavailable = "true";
  }
}
