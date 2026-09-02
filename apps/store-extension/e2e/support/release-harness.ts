import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

type RuntimeListener = (
  message: unknown,
  sender: { readonly id: string; readonly url: string },
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

type PortMessageListener = (message: unknown) => void;

const extensionId = "huayi-store-e2e";
const messageVersion = STORE_MESSAGE_VERSION;
const runtimeListeners: RuntimeListener[] = [];
let siteEnabled = true;
let requestSequence = 0;
const overlayTheme =
  new URL(window.location.href).searchParams.get("theme") === "parchment" ? "parchment" : "pearl";
const storedAppearance = window.localStorage.getItem("huayi.store.e2e.appearance");
const appearance =
  storedAppearance === "moon" ||
  storedAppearance === "silver" ||
  storedAppearance === "champagne" ||
  storedAppearance === "porcelain"
    ? storedAppearance
    : "silver";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function appendLog(type: string, message: Record<string, unknown>): void {
  const entry = document.createElement("li");
  entry.dataset.logType = type;
  entry.dataset.messageKeys = Object.keys(message).sort().join(",");
  document.querySelector("[data-testid='message-log']")?.append(entry);
}

class FakeAnalysisPort {
  private readonly messageListeners: PortMessageListener[] = [];

  readonly onDisconnect = {
    addListener: (listener: () => void): void => {
      void listener;
    },
  };

  readonly onMessage = {
    addListener: (listener: PortMessageListener): void => {
      this.messageListeners.push(listener);
    },
  };

  disconnect(): void {
    // A completed fake session closes silently, as the Worker does after its terminal result.
  }

  postMessage(value: unknown): void {
    const message = asRecord(value);
    if (message.type !== "store/analysis-start") return;
    appendLog("analysis", message);
    const requestId = `offline-${++requestSequence}`;
    queueMicrotask(() => {
      if (message.selection === "failure") {
        this.emit({
          code: "network-error",
          messageVersion,
          requestId,
          type: "store/analysis-error",
        });
        return;
      }
      this.emit({
        messageVersion,
        type: "store/analysis-update",
        update: { requestId, stage: "running", type: "progress" },
      });
      this.emit({
        messageVersion,
        result: {
          commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
          commonPhrases: [],
          confusableWords: [],
          contextualSense: { meaningZh: "这里指持续进行的调查", partOfSpeech: "noun" },
          dictionaryForm: "investigation",
          requestId,
          selectionKind: "word",
          sourceText: String(message.selection),
          type: "translate-word",
        },
        type: "store/analysis-result",
      });
    });
  }

  private emit(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

async function sendMessage(value: unknown): Promise<unknown> {
  const message = asRecord(value);
  if (message.type === "store/handshake") {
    return {
      compatible: true,
      extensionVersion: "1.0.0-e2e",
      messageVersion,
      requestId: message.requestId,
      type: "store/handshake-result",
    };
  }
  if (message.type === "store/site-policy" || message.type === "store/site-toggle") {
    if (message.type === "store/site-toggle") {
      siteEnabled = message.enabled === true;
      appendLog("site-toggle", message);
    }
    window.setTimeout(() => {
      document.documentElement.dataset.storeHarnessReady = "true";
    }, 0);
    return {
      appearance,
      defaultAction: "ask",
      enabled: siteEnabled,
      globallyEnabled: true,
      host: window.location.hostname,
      messageVersion,
      overlayTheme,
      type: "store/site-policy-result",
    };
  }
  if (message.type === "store/lexicon-save") {
    appendLog("lexicon", message);
    return { messageVersion, status: "saved", type: "store/lexicon-save-result" };
  }
  if (message.type === "store/lexicon-presence") {
    return { messageVersion, present: false, type: "store/lexicon-presence-result" };
  }
  throw new Error("The offline Store harness received an unexpected runtime message.");
}

Reflect.set(globalThis, "chrome", {
  runtime: {
    connect: (): FakeAnalysisPort => new FakeAnalysisPort(),
    getURL: (path: string): string => `/apps/store-extension/dist/${path}`,
    id: extensionId,
    onMessage: {
      addListener: (listener: RuntimeListener): void => {
        runtimeListeners.push(listener);
      },
    },
    sendMessage,
  },
});

async function sendPopupMessage(message: unknown): Promise<unknown> {
  return await new Promise((resolve) => {
    let handled = false;
    for (const listener of runtimeListeners) {
      const result = listener(
        message,
        { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` },
        resolve,
      );
      handled ||= result === true;
    }
    if (!handled) resolve(undefined);
  });
}

document.querySelector("[data-testid='disable-site']")?.addEventListener("click", () => {
  void sendPopupMessage({
    enabled: false,
    messageVersion,
    type: "store/popup-site-toggle",
  }).then((response) => {
    const status = document.querySelector("[data-testid='site-status']");
    if (status !== null) {
      status.textContent = asRecord(response).enabled === false ? "disabled" : "error";
    }
  });
});

const packagedContentScript = document.createElement("script");
packagedContentScript.src = "/apps/store-extension/dist/content-script.js";
document.head.append(packagedContentScript);
