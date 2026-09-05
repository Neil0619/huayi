import {
  STORE_MESSAGE_VERSION,
  parseStoreOpenWebWorkspaceRequest,
  type StoreOpenWebWorkspaceResponse,
  type StoreOpenWebWorkspaceRequest,
} from "@huayi/store-domain";

export async function handleOpenWebWorkspace(
  message: unknown,
  senderId: string | undefined,
  extensionId: string,
  webWorkspaceUrl: string | null,
  createTab: (properties: { url: string }) => Promise<unknown>,
): Promise<StoreOpenWebWorkspaceResponse | undefined> {
  if (senderId !== extensionId) return undefined;
  let request: StoreOpenWebWorkspaceRequest;
  try {
    request = parseStoreOpenWebWorkspaceRequest(message);
  } catch {
    return undefined;
  }
  if (webWorkspaceUrl === null) {
    return {
      messageVersion: STORE_MESSAGE_VERSION,
      opened: false,
      reason: "not-configured",
      type: "store/open-web-workspace-result",
    };
  }
  let workspace: URL;
  try {
    workspace = new URL(webWorkspaceUrl);
  } catch {
    return undefined;
  }
  if (workspace.protocol !== "https:" || workspace.username !== "" || workspace.password !== "") {
    return undefined;
  }
  await createTab({
    url:
      request.destination === "wordbooks"
        ? new URL("/words/wordbooks", workspace).href
        : workspace.href,
  });
  return {
    messageVersion: STORE_MESSAGE_VERSION,
    opened: true,
    type: "store/open-web-workspace-result",
  };
}
