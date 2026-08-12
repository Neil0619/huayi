import {
  STORE_MESSAGE_VERSION,
  parseStoreSitePoliciesChangedRequest,
  type StoreSitePoliciesChangedResponse,
  type StoreSiteRelayMessage,
} from "@huayi/store-domain";

interface ExtensionSender {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
}

export function isSitePoliciesChangedMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "store/site-policies-changed"
  );
}

function isExactOptionsSender(sender: ExtensionSender, extensionId: string): boolean {
  if (sender.id !== extensionId || sender.url === undefined) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === extensionId &&
      url.pathname === "/options.html" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export async function handleSitePoliciesChanged(
  value: unknown,
  sender: ExtensionSender,
  extensionId: string,
  broadcast: (message: StoreSiteRelayMessage) => Promise<void>,
): Promise<StoreSitePoliciesChangedResponse | undefined> {
  if (!isSitePoliciesChangedMessage(value) || !isExactOptionsSender(sender, extensionId)) {
    return undefined;
  }
  try {
    parseStoreSitePoliciesChangedRequest(value);
  } catch {
    return undefined;
  }
  await broadcast({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/site-policy-refresh",
  });
  return {
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/site-policies-refreshed",
  };
}
