import {
  STORE_MESSAGE_VERSION,
  parseCloudSessionRequest,
  parseCloudSessionResponse,
  type CloudSessionResponse,
} from "@huayi/store-domain";

import type { CloudSessionManager } from "./cloud-session-manager.js";

export const CLOUD_PAIRING_POLL_ALARM = "huayi-cloud-pairing-poll";
export const CLOUD_PAIRING_POLL_DELAY_MS = 5_000;

interface CloudSessionHandlerOptions {
  readonly manager: CloudSessionManager;
  readonly runtimeId: string;
  readonly schedulePoll: () => void;
  readonly sender: {
    readonly id?: string | undefined;
    readonly url?: string | undefined;
  };
}

function isPrivilegedExtensionPage(
  sender: CloudSessionHandlerOptions["sender"],
  runtimeId: string,
): boolean {
  if (sender.id !== runtimeId || sender.url === undefined) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === runtimeId &&
      (url.pathname === "/options.html" || url.pathname === "/popup.html") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function response(state: Awaited<ReturnType<CloudSessionManager["status"]>>): CloudSessionResponse {
  return parseCloudSessionResponse({
    ...state,
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/cloud-session-result",
  });
}

export async function handleCloudSessionMessage(
  raw: unknown,
  options: CloudSessionHandlerOptions,
): Promise<CloudSessionResponse | undefined> {
  if (!isPrivilegedExtensionPage(options.sender, options.runtimeId)) return undefined;
  let request;
  try {
    request = parseCloudSessionRequest(raw);
  } catch {
    return undefined;
  }
  if (request.type === "store/cloud-session-start") {
    const state = await options.manager.start();
    if (state.status === "pairing") options.schedulePoll();
    return response(state);
  }
  if (request.type === "store/cloud-session-disconnect") {
    return response(await options.manager.disconnect());
  }
  const state = await options.manager.status();
  if (state.status === "pairing") options.schedulePoll();
  return response(state);
}
