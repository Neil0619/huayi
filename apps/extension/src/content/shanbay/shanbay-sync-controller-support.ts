import type { ShanbayCommand } from "../../shared/extension-messages.js";

export const SHANBAY_COLLECTION_HASH = "#/collection";
export const SHANBAY_COLLECTION_PATH = "/wordsweb/";
export const SHANBAY_ORIGIN = "https://web.shanbay.com";
export const MANUAL_CONFIRMATION_DELAY_MS = 10_000;

export type BrowserTimer = number;
export type BrowserSetTimeout = (handler: () => void, timeout: number) => BrowserTimer;

export interface ShanbaySyncControllerOptions {
  document: Document;
  sendMessage(message: ShanbayCommand): Promise<unknown> | undefined;
  setTimeout?: BrowserSetTimeout;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isShanbayCollectionPage(location: Location): boolean {
  return (
    location.origin === SHANBAY_ORIGIN &&
    location.pathname === SHANBAY_COLLECTION_PATH &&
    location.hash === SHANBAY_COLLECTION_HASH
  );
}

export function createBrowserSetTimeout(document: Document): BrowserSetTimeout {
  return (handler, timeout) => {
    const windowRef = document.defaultView;
    return (
      windowRef?.setTimeout(handler, timeout) ?? Number(globalThis.setTimeout(handler, timeout))
    );
  };
}
