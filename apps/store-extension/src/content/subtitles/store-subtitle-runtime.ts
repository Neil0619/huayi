import {
  STORE_ANALYSIS_PORT_NAME,
  STORE_MESSAGE_VERSION,
  type StoreOpenWebWorkspaceRequest,
  parseStoreOpenWebWorkspaceResponse,
  type StoreOpenOptionsRequest,
} from "@huayi/store-domain";
import type {
  ContentAnalysisPort,
  StoreOverlayRuntime,
} from "../overlay/store-overlay-controller.js";
export function sendStoreSubtitleMessage(message: unknown): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

export const storeSubtitleRuntime: StoreOverlayRuntime = {
  connectAnalysis: () =>
    chrome.runtime.connect({ name: STORE_ANALYSIS_PORT_NAME }) as ContentAnalysisPort,
  openOptions: async () => {
    const message: StoreOpenOptionsRequest = {
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/open-options",
    };
    await sendStoreSubtitleMessage(message);
  },
  openWebWorkspace: async () => {
    const message: StoreOpenWebWorkspaceRequest = {
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/open-web-workspace",
    };
    const response = parseStoreOpenWebWorkspaceResponse(await sendStoreSubtitleMessage(message));
    if (!response.opened) throw new Error("Web workspace is not configured.");
  },
  overlayStylesheetUrl: () => chrome.runtime.getURL("overlay.css"),
  queryWordPresence: sendStoreSubtitleMessage,
  saveWord: sendStoreSubtitleMessage,
  studyCapture: sendStoreSubtitleMessage,
};
