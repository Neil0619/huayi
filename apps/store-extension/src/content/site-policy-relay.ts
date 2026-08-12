import { parseStoreSiteRelayMessage } from "@huayi/store-domain";

import type { StoreSiteLifecycle } from "./site-lifecycle-registry.js";

interface RelaySender {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
}

type RelayListener = (
  message: unknown,
  sender: RelaySender,
  sendResponse: (value: unknown) => void,
) => boolean | undefined;

interface SitePolicyRelayRuntime {
  readonly extensionId: string;
  addListener(listener: RelayListener): void;
}

interface RelayRegistryEntry {
  readonly installed: true;
}

const SITE_POLICY_RELAY_KEY = Symbol.for("@huayi/store-extension/site-policy-relay");

function isExactPopupSender(sender: RelaySender, extensionId: string): boolean {
  if (sender.id !== extensionId || sender.url === undefined) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === extensionId &&
      url.pathname === "/popup.html" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function installStoreSitePolicyRelay(
  lifecycle: StoreSiteLifecycle,
  runtime: SitePolicyRelayRuntime,
): void {
  const existing = Reflect.get(globalThis, SITE_POLICY_RELAY_KEY) as RelayRegistryEntry | undefined;
  if (existing !== undefined) return;
  Reflect.set(globalThis, SITE_POLICY_RELAY_KEY, { installed: true });
  runtime.addListener((message, sender, sendResponse) => {
    let parsed;
    try {
      parsed = parseStoreSiteRelayMessage(message);
    } catch {
      return false;
    }
    if (parsed.type === "store/site-policy-refresh") {
      if (sender.id !== runtime.extensionId) return false;
      void lifecycle.refresh().catch(() => undefined);
      return false;
    }
    if (!isExactPopupSender(sender, runtime.extensionId)) return false;
    const response =
      parsed.type === "store/popup-site-toggle"
        ? lifecycle.toggle(parsed.enabled)
        : lifecycle.refresh();
    void response.then(sendResponse).catch(() => sendResponse(undefined));
    return true;
  });
}
