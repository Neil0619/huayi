import {
  STORE_MESSAGE_VERSION,
  type AnalysisEngine,
  type AnalysisResult,
  type StoreAnalysisClientMessage,
  type StoreSettings,
} from "@huayi/store-domain";
import { createQueryCache } from "../../src/service-worker/query-cache.js";
import { createAnalysisSession } from "../../src/service-worker/analysis-session.js";
import {
  StoreOverlayController,
  type ContentAnalysisPort,
} from "../../src/content/overlay/store-overlay-controller.js";
import { readStoreSelection } from "../../src/content/selection/read-selection.js";

const settings: StoreSettings = {
  defaultAction: "ask",
  globallyEnabled: true,
  networkConsent: { grantedAt: "2026-09-05T00:00:00Z", version: 1 },
  overlayTheme: "pearl",
  providerId: "deepseek",
  recipientAccess: {
    eudic: { consent: null, enabled: false },
    shanbay: { consent: null, enabled: false },
  },
  schemaVersion: 6,
  sitePolicy: { defaultAction: "allow", rules: [] },
  youtubeMode: "english",
  youtubeShortcut: null,
};
let stored: unknown;
const cache = createQueryCache({
  storage: {
    read: async () => stored,
    write: async (value) => {
      stored = structuredClone(value);
    },
  },
});
let calls = 0;
let finish: () => void = () => undefined;
let openedAt = 0;
const engine: AnalysisEngine = {
  async analyze(request, _signal, update) {
    document.body.dataset.calls = String(++calls);
    const keyExpressions = [
      {
        text: "Andalusia's regional leader Juanma Moreno has said",
        meaningZh: "安达卢西亚大区主席胡安马莫雷诺表示",
      },
    ];
    update?.({
      type: "delta",
      requestId: request.requestId,
      sequence: 1,
      section: "main-structure",
      text: "主语与谓语已经可以阅读。",
    });
    update?.({
      type: "section",
      requestId: request.requestId,
      sequence: 2,
      section: "key-expressions",
      value: keyExpressions,
    });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    const result: AnalysisResult =
      request.action === "translate"
        ? {
            type: "translate-passage",
            requestId: request.requestId,
            selectionKind: "sentence",
            sourceText: request.selection,
            translationZh: "至少十二人遇难。",
          }
        : {
            type: "explain-sentence",
            requestId: request.requestId,
            selectionKind: "sentence",
            sourceText: request.selection,
            mainStructure: "主语与谓语。".repeat(50),
            translationZh: "至少十二人遇难。",
            keyExpressions,
            contextRole: "新闻中补充信息来源。",
          };
    return result;
  },
};
function connectAnalysis(): ContentAnalysisPort {
  let receiveWorker: (message: StoreAnalysisClientMessage) => void = () => undefined;
  let receiveContent: (message: unknown) => void = () => undefined;
  let disconnectWorker: () => void = () => undefined;
  let disconnectContent: () => void = () => undefined;
  createAnalysisSession(
    {
      onMessage: {
        addListener: (listener) => {
          receiveWorker = listener;
        },
      },
      onDisconnect: {
        addListener: (listener) => {
          disconnectWorker = listener;
        },
      },
      postMessage: (message) => {
        receiveContent(message);
        if (message.type === "store/analysis-result")
          requestAnimationFrame(() => {
            document.body.dataset.resultMs = String(performance.now() - openedAt);
          });
      },
    },
    {
      analysisEngine: {
        analyze: (request, signal, update) =>
          cache.analyze("offline-account", engine, request, signal, update ?? (() => undefined)),
      },
      cancelAnalysis: (id) => cache.cancel(id),
      createRequestId: () => crypto.randomUUID(),
      getSettings: async () => settings,
      siteHost: "example.test",
    },
  );
  return {
    onMessage: {
      addListener: (listener) => {
        receiveContent = listener;
      },
    },
    onDisconnect: {
      addListener: (listener) => {
        disconnectContent = listener;
      },
    },
    disconnect: () => {
      disconnectWorker();
      disconnectContent();
    },
    postMessage: (message) => receiveWorker(message),
  };
}
const packagedProfile = new URL(location.href).searchParams.get("package");
const packagedRoot =
  packagedProfile === "hosted"
    ? "/apps/store-extension/dist"
    : packagedProfile === "release"
      ? "/apps/store-extension/dist-release"
      : null;
const controller =
  packagedRoot === null
    ? new StoreOverlayController(document, {
        connectAnalysis,
        overlayStylesheetUrl: () => "/apps/store-extension/pages/overlay.css",
        openOptions: async () => undefined,
        openWebWorkspace: async () => undefined,
        queryWordPresence: async () => ({
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/lexicon-presence-result",
          present: false,
        }),
        saveWord: async () => undefined,
        studyCapture: async () => ({
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/study-capture-result",
          outcome: "skipped",
        }),
      })
    : null;
if (packagedRoot !== null) {
  Reflect.set(globalThis, "chrome", {
    runtime: {
      id: "hoijjhgcckfhbcefoclgbhkgninnkknd",
      connect: connectAnalysis,
      getURL: (path: string) => `${packagedRoot}/${path}`,
      onMessage: { addListener: () => undefined },
      sendMessage: async (message: { type: string; requestId?: string }) => {
        if (message.type === "store/handshake")
          return {
            compatible: true,
            extensionVersion: "1.0.0",
            messageVersion: STORE_MESSAGE_VERSION,
            requestId: message.requestId,
            type: "store/handshake-result",
          };
        if (message.type === "store/site-policy")
          return {
            appearance: "porcelain",
            defaultAction: "ask",
            enabled: true,
            globallyEnabled: true,
            host: location.hostname,
            messageVersion: STORE_MESSAGE_VERSION,
            overlayTheme: "pearl",
            type: "store/site-policy-result",
          };
        if (message.type === "store/lexicon-presence")
          return {
            messageVersion: STORE_MESSAGE_VERSION,
            present: false,
            type: "store/lexicon-presence-result",
          };
        throw new Error("Unexpected packaged query fixture request");
      },
    },
  });
  const script = document.createElement("script");
  script.src = `${packagedRoot}/content-script.js`;
  script.addEventListener("load", () => {
    document.body.dataset.packagedReady = "true";
  });
  document.head.append(script);
}
const show = () => {
  const original = document.querySelector("#original");
  if (!original) throw new Error("Missing original");
  const range = document.createRange();
  range.selectNodeContents(original);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  const selection = readStoreSelection();
  if (!selection) throw new Error("Missing selection");
  openedAt = performance.now();
  delete document.body.dataset.resultMs;
  controller?.show(selection, range.getBoundingClientRect());
};
document.querySelector("#show")?.addEventListener("click", show);
export interface QueryInteractionFixture {
  show(): void;
  finish(): void;
  setDefault(): void;
  theme(): void;
}
window.queryFixture = {
  show,
  finish: () => finish(),
  setDefault: () => controller?.setDefaultAction("explain"),
  theme: () => controller?.setAppearance("porcelain"),
};
declare global {
  interface Window {
    queryFixture: QueryInteractionFixture;
  }
}
document.body.dataset.ready = "true";
