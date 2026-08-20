import {
  STORE_ANALYSIS_PORT_NAME,
  STORE_MESSAGE_VERSION,
  type AnalysisEngine,
  type AnalysisResult,
  type LexiconRepository,
  type ShanbayBatch,
  type StoreSettings,
  type WordEntry,
} from "@huayi/store-domain";

import type { ContentAnalysisPort } from "../../src/content/overlay/store-overlay-controller.js";
import { createCloudStudyCaptureApi } from "../../src/service-worker/cloud-study-capture-api.js";
import { createCloudExtensionQueryApi } from "../../src/service-worker/cloud-extension-query-api.js";
import { createCloudIdentityApi } from "../../src/service-worker/cloud-identity-api.js";
import { createCloudSubmissionApi } from "../../src/service-worker/cloud-submission-api.js";
import { createCloudWordCopyApi } from "../../src/service-worker/cloud-word-copy-api.js";
import { createCloudWordCopyClient } from "../../src/service-worker/cloud-word-copy-client.js";
import { createCloudWordbookApi } from "../../src/service-worker/cloud-wordbook-api.js";
import { createCloudExternalWordbookBridge } from "../../src/service-worker/cloud-external-wordbook-bridge.js";
import { createCloudShanbayBridge } from "../../src/service-worker/cloud-shanbay-bridge.js";
import { createExternalWordbookLeaseVault } from "../../src/service-worker/external-wordbook-lease-vault.js";
import { handleShanbayMessage } from "../../src/service-worker/shanbay-message-handler.js";
import { clearCloudAccountData } from "../../src/service-worker/cloud-account-data-clearer.js";
import { createCloudSessionManager } from "../../src/service-worker/cloud-session-manager.js";
import { createExtensionSessionVault } from "../../src/service-worker/extension-session-vault.js";
import { createProductionLocalWordImportRuntime } from "../../src/service-worker/production-local-word-import-runtime.js";
import {
  createAnalysisSession,
  type AnalysisSessionPort,
} from "../../src/service-worker/analysis-session.js";
import { runSubmissionOutboxAlarm } from "../../src/service-worker/submission-outbox-alarm.js";
import { createSubmissionOutbox } from "../../src/service-worker/submission-outbox.js";
import type { SubmissionOutboxState } from "../../src/service-worker/submission-outbox-vault.js";
import { siteHostFromSenderUrl } from "../../src/service-worker/site-policy-handler.js";
import { handleStudyCaptureMessage } from "../../src/service-worker/study-capture-handler.js";
import { createProductionQueryEngine } from "../../src/service-worker/production-query-engine.js";
import { handleLexiconMessage } from "../../src/service-worker/lexicon-message-handler.js";
import { LocalWordImportOptionsController } from "../../src/options/local-word-import-options-controller.js";
import { BrowserWordbookExportEngine } from "../../src/wordbook/browser-wordbook-export-engine.js";
import { createInitialWordbookState } from "../../src/wordbook/wordbook-state.js";

type RuntimeListener = (
  message: unknown,
  sender: { readonly id: string; readonly url: string },
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

const apiOrigin = "https://api.huayi.invalid";
const extensionId = "huayi-store-cloud-e2e";
const sessionToken = "cloud-e2e-extension-session-token-000000000000";
const secondarySessionToken = "cloud-e2e-secondary-session-token-00000000000";
const validSessionExpiresAt = "2099-01-01T00:00:00.000Z";
const senderUrl = window.location.href;
const clientNamespace = new URL(senderUrl).searchParams.get("client") ?? "primary";
const batchImportFixture = new URL(senderUrl).searchParams.has("batch-import");
const eudicCloudFailureFixture = new URL(senderUrl).searchParams.has("eudic-cloud-failure");
const eudicImportFixture = new URL(senderUrl).searchParams.has("eudic-local-import");
const localWordImportFixture = batchImportFixture || eudicImportFixture;
const shanbayCloudFixture = new URL(senderUrl).searchParams.has("shanbay-cloud");
const runtimeListeners: RuntimeListener[] = [];
let outboxState: SubmissionOutboxState = { items: [] };
let networkAvailable = !new URL(senderUrl).searchParams.has("offline");
let requestSequence = 0;
let idempotencySequence = 0;

const preferences = {
  cloudWordCopyMode: new URL(senderUrl).searchParams.has("word-copy-disabled")
    ? ("disabled" as const)
    : ("enabled" as const),
  extensionQueryModelMode: new URL(senderUrl).searchParams.has("platform")
    ? ("platform" as const)
    : ("byok" as const),
  revision: 1,
  studyCaptureMode: new URL(senderUrl).searchParams.has("automatic")
    ? ("automatic" as const)
    : ("manual" as const),
  updatedAt: "2026-08-13T10:00:00.000Z",
};

const settings: StoreSettings = {
  defaultAction: "ask",
  globallyEnabled: true,
  networkConsent: { grantedAt: "2026-08-13T09:00:00.000Z", version: 1 },
  overlayTheme: "pearl",
  providerId: "deepseek",
  recipientAccess: {
    eudic: { consent: null, enabled: false },
    shanbay: shanbayCloudFixture
      ? {
          consent: { grantedAt: "2026-08-13T09:00:00.000Z", version: 1 as const },
          enabled: true,
        }
      : { consent: null, enabled: false },
  },
  schemaVersion: 6,
  sitePolicy: { defaultAction: "allow", rules: [] },
  youtubeMode: "english",
  youtubeShortcut: null,
};

const localWords = new Map<string, WordEntry>();
const localLexicon: LexiconRepository = {
  delete: async (id) => localWords.delete(id),
  exportWordList: async () =>
    localWords.size === 0 ? "" : `${[...localWords.keys()].sort().join("\n")}\n`,
  findByHeadword: async (headword) => localWords.get(headword.toLowerCase()) ?? null,
  list: async () => ({ entries: [...localWords.values()], nextCursor: null }),
  save: async (input) => {
    const headword = input.headword.toLowerCase();
    const now = "2026-08-13T10:00:00.000Z";
    const contexts: WordEntry["contexts"] =
      input.context === undefined
        ? []
        : input.context.source === "eudic-import"
          ? [
              {
                id: `local-context-${localWords.size + 1}`,
                observedAt: input.context.observedAt,
                sentence: input.context.sentence,
                source: "eudic-import",
              },
            ]
          : [
              {
                contextualMeaningZh: input.context.contextualMeaningZh,
                id: `local-context-${localWords.size + 1}`,
                observedAt: now,
                sentence: input.context.sentence,
                source: input.context.source,
              },
            ];
    const entry: WordEntry = {
      contexts,
      createdAt: now,
      headword,
      id: headword,
      updatedAt: now,
    };
    localWords.set(headword, entry);
    return entry;
  },
  snapshot: async () => [...localWords.values()],
};

if (batchImportFixture) {
  for (let index = 0; index < 201; index += 1) {
    const sequence = String(index).padStart(3, "0");
    const headword = `archiveword${sequence}`;
    localWords.set(headword, {
      contexts:
        index === 0
          ? []
          : [
              {
                contextualMeaningZh: `历史语境 ${sequence}`,
                id: `archive-context-${sequence}`,
                observedAt: "2026-08-13T10:00:00.000Z",
                sentence: `The learner collected archive word ${sequence}.`,
                source: "web",
              },
            ],
      createdAt: "2026-08-13T10:00:00.000Z",
      headword,
      id: `archive-entry-${sequence}`,
      updatedAt: "2026-08-13T10:00:00.000Z",
    });
  }
}

const engine: AnalysisEngine = {
  async analyze(request, signal, onUpdate): Promise<AnalysisResult> {
    signal.throwIfAborted();
    onUpdate({ requestId: request.requestId, stage: "running", type: "progress" });
    if (request.selectionKind === "sentence" || request.selectionKind === "passage") {
      return {
        requestId: request.requestId,
        selectionKind: request.selectionKind,
        sourceText: request.selection,
        translationZh: "调查整个冬天都在持续。",
        type: "translate-passage",
      };
    }
    return {
      commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
      commonPhrases: [],
      confusableWords: [],
      contextualSense: { meaningZh: "这里指持续进行的调查", partOfSpeech: "noun" },
      dictionaryForm: request.selection.toLowerCase(),
      requestId: request.requestId,
      selectionKind: "word",
      sourceText: request.selection,
      type: "translate-word",
    };
  },
};

const studyCaptureApi = createCloudStudyCaptureApi({
  apiOrigin,
  clientVersion: "1.0.0",
  fetch: (input, init) =>
    networkAvailable
      ? fetch(input, init)
      : Promise.reject(new TypeError("The E2E network is offline.")),
});
const cloudWordCopyApi = createCloudWordCopyApi({
  apiOrigin,
  clientVersion: "1.0.0",
  fetch: (input, init) =>
    networkAvailable
      ? fetch(input, init)
      : Promise.reject(new TypeError("The E2E network is offline.")),
});
const cloudWordbookApi = createCloudWordbookApi({
  apiOrigin,
  clientVersion: "1.0.0",
  fetch: (input, init) => fetch(input, init),
});
const cloudIdentityApi = createCloudIdentityApi({
  apiOrigin,
  clientVersion: "1.0.0",
  fetch: (input, init) =>
    networkAvailable
      ? fetch(input, init)
      : Promise.reject(new TypeError("The E2E network is offline.")),
});
const extensionQueryApi = createCloudExtensionQueryApi({
  apiOrigin,
  clientVersion: "1.0.0",
  fetch: (input, init) => fetch(input, init),
});
const sessionStorage = new Map<string, unknown>();
const sessionVault = createExtensionSessionVault({
  crypto: globalThis.crypto,
  deviceVault: { getDek: async () => new Uint8Array(32).fill(9) },
  storage: {
    delete: async (key) => {
      sessionStorage.delete(key);
    },
    read: async (key) => sessionStorage.get(key),
    write: async (key, value) => {
      sessionStorage.set(key, structuredClone(value));
    },
  },
});
await sessionVault.writeSession({
  expiresAt: validSessionExpiresAt,
  preferences,
  token: sessionToken,
});
const localWordImportStorage = new Map<string, unknown>();
const localWordImportRuntime = createProductionLocalWordImportRuntime({
  alarms: { create: async () => undefined },
  api: cloudWordCopyApi,
  clientVersion: "1.0.0",
  crypto: globalThis.crypto,
  deviceVault: { getDek: async () => new Uint8Array(32).fill(7) },
  lexicon: localLexicon,
  sessionVault,
  settings: { get: async () => settings },
  storage: {
    deletePersistent: async (key) => {
      localWordImportStorage.delete(key);
    },
    readPersistent: async (key) => localWordImportStorage.get(key),
    writePersistent: async (key, value) => {
      localWordImportStorage.set(key, structuredClone(value));
    },
  },
});
const queryEngine = createProductionQueryEngine({
  byok: engine,
  cloudApi: extensionQueryApi,
  preferences: {
    read: async () => preferences,
    sync: async () => preferences,
  },
  sessionVault,
  sourceType: "web-selection",
});
const outbox = createSubmissionOutbox({
  allowUpload: async () => true,
  api: createCloudSubmissionApi({
    studyCaptures: studyCaptureApi,
    wordCopies: cloudWordCopyApi,
  }),
  clientVersion: "1.0.0",
  createIdempotencyKey: () =>
    `store-e2e-${clientNamespace}-capture-${String(++idempotencySequence).padStart(8, "0")}`,
  now: () => Date.parse("2026-08-13T10:00:00.000Z"),
  sessionVault,
  vault: {
    clear: async () => {
      outboxState = { items: [] };
    },
    read: async () => structuredClone(outboxState),
    write: async (value) => {
      outboxState = structuredClone(value);
    },
  },
});
const cloudWordCopy = createCloudWordCopyClient({
  outbox,
  preferences: { sync: async () => preferences },
  scheduleRetry: () => setCloudStatus("queued"),
});
const clearAccountData = () => clearCloudAccountData(outbox, localWordImportRuntime);
const cloudSessionManager = createCloudSessionManager({
  api: {
    createPairing: async () => ({
      expiresAt: validSessionExpiresAt,
      id: "switch-account-pairing",
      pairingPath: "/pair-extension/switch-account-pairing",
      status: "pending" as const,
    }),
    disconnectExtensionSession: (token) => cloudIdentityApi.disconnectExtensionSession(token),
    exchangePairing: async () => ({
      expiresAt: validSessionExpiresAt,
      preferences: { ...preferences, revision: 2 },
      sessionToken: secondarySessionToken,
    }),
    getExtensionPreferences: async () => ({ ...preferences, revision: 2 }),
    getPairing: async () => ({
      expiresAt: validSessionExpiresAt,
      id: "switch-account-pairing",
      pairingPath: "/pair-extension/switch-account-pairing",
      status: "approved" as const,
    }),
  },
  clearSubmissions: clearAccountData,
  crypto: globalThis.crypto,
  now: () => Date.parse("2026-08-13T10:00:00.000Z"),
  open: async () => undefined,
  randomBytes: (length) => new Uint8Array(length).fill(5),
  vault: sessionVault,
  webOrigin: "https://web.huayi.invalid",
});
const cloudWordbookBridge = createCloudExternalWordbookBridge({
  allowTarget: async () => true,
  api: cloudWordbookApi,
  eudic: {
    addWord: async () => {
      if (eudicCloudFailureFixture) throw new Error("Simulated Eudic network failure.");
      return "created" as const;
    },
    listWords: async () => [
      {
        addedAt: "2026-08-12T10:00:00.000Z",
        contextLine: "The imported phrase works in context.",
        headword: "make do",
      },
    ],
  },
  idempotencyKey: () => `wordbook-e2e-key-${++idempotencySequence}`,
  randomNonce: () => `wordbook-e2e-nonce-${String(++idempotencySequence).padStart(32, "0")}`,
  session: () => sessionVault.readSession(),
});
const externalWordbookLeaseStorage = new Map<string, unknown>();
const externalWordbookLeaseVault = createExternalWordbookLeaseVault({
  crypto: globalThis.crypto,
  deviceVault: { getDek: async () => new Uint8Array(32).fill(11) },
  storage: {
    delete: async (key) => {
      externalWordbookLeaseStorage.delete(key);
    },
    read: async (key) => externalWordbookLeaseStorage.get(key),
    write: async (key, value) => {
      externalWordbookLeaseStorage.set(key, structuredClone(value));
    },
  },
});
let shanbayIdSequence = 0;
const cloudShanbayBridge = createCloudShanbayBridge({
  allow: async () => shanbayCloudFixture,
  api: cloudWordbookApi,
  idempotencyKey: () => `shanbay-e2e-receipt-${++idempotencySequence}`,
  randomId: () => `shanbay-e2e-local-${String(++shanbayIdSequence).padStart(32, "0")}`,
  sessionVault,
  vault: externalWordbookLeaseVault,
});
let currentShanbayBatch: ShanbayBatch | null = null;
let wordbookState = {
  revision: 0,
  state: createInitialWordbookState("2026-08-13T10:00:00.000Z"),
};
let wordbookIdSequence = 0;
const localWordbookEngine = new BrowserWordbookExportEngine({
  clock: () => new Date("2026-08-13T10:00:00.000Z"),
  eudic: {
    addWord: async () => "created" as const,
    listWords: async () => [
      {
        addedAt: "2026-08-12T10:00:00.000Z",
        contextLine: "The evidence remained persuasive.",
        headword: "evidence",
      },
      {
        addedAt: "2026-08-12T10:00:00.000Z",
        headword: "hypothesis",
      },
    ],
  },
  leaseDurationMs: 60_000,
  lexicon: localLexicon,
  randomId: () => `wordbook-e2e-id-${++wordbookIdSequence}`,
  stateStore: {
    compareAndSwap: async (expectedRevision, state) => {
      if (wordbookState.revision !== expectedRevision) return false;
      wordbookState = { revision: expectedRevision + 1, state: structuredClone(state) };
      return true;
    },
    read: async () => structuredClone(wordbookState),
  },
});

function setCloudStatus(value: string): void {
  const output = document.querySelector<HTMLOutputElement>("[data-testid='cloud-status']");
  if (output !== null) output.value = value;
}

document.querySelector("[data-testid='cloud-reconnect']")?.addEventListener("click", () => {
  networkAvailable = true;
  void runSubmissionOutboxAlarm(outbox, () => setCloudStatus("queued"))
    .then(() => outbox.status())
    .then((status) => setCloudStatus(status.state === "empty" ? "submitted" : status.state))
    .catch(() => setCloudStatus("failed"));
});

document.querySelector("[data-testid='cloud-network-only']")?.addEventListener("click", () => {
  networkAvailable = true;
  setCloudStatus("network-restored");
});

document.querySelector("[data-testid='cloud-disconnect']")?.addEventListener("click", () => {
  void cloudSessionManager
    .disconnect()
    .then(() => setCloudStatus(`disconnected-local:${localWords.size}`))
    .catch(() => setCloudStatus("disconnect-failed"));
});

document.querySelector("[data-testid='cloud-switch-account']")?.addEventListener("click", () => {
  void cloudSessionManager
    .disconnect()
    .then(() => cloudSessionManager.start())
    .then(() => cloudSessionManager.continuePairing())
    .then(() => setCloudStatus(`switched-local:${localWords.size}`))
    .catch(() => setCloudStatus("switch-failed"));
});

document.querySelector("[data-testid='cloud-run-wordbook-job']")?.addEventListener("click", () => {
  void cloudWordbookBridge
    .processOne()
    .then((processed) =>
      setCloudStatus(processed ? `wordbook-processed-local:${localWords.size}` : "wordbook-idle"),
    )
    .catch(() => setCloudStatus("wordbook-failed"));
});

document.querySelector("[data-testid='cloud-claim-shanbay']")?.addEventListener("click", () => {
  void handleShanbayMessage(
    { messageVersion: STORE_MESSAGE_VERSION, type: "store/shanbay-page-ready" },
    { url: "https://web.shanbay.com/wordsweb/#/collection" },
    cloudShanbayBridge,
    async () => settings,
  )
    .then((response) => {
      currentShanbayBatch = response?.type === "store/shanbay-batch" ? response.batch : null;
      const confirm = document.querySelector<HTMLButtonElement>(
        "[data-testid='cloud-confirm-shanbay']",
      );
      if (confirm !== null) confirm.disabled = currentShanbayBatch === null;
      setCloudStatus(
        currentShanbayBatch === null
          ? "shanbay-idle"
          : `shanbay-ready:${currentShanbayBatch.items.map((item) => item.entryId).join(",")}`,
      );
    })
    .catch(() => setCloudStatus("shanbay-failed"));
});

function resolveShanbayBatch(result: "confirmed" | "partial"): void {
  const batch = currentShanbayBatch;
  if (batch === null) return;
  const confirmedOutboxIds =
    result === "confirmed"
      ? batch.items.map((item) => item.outboxId)
      : batch.items.slice(0, 1).map((item) => item.outboxId);
  const failedOutboxIds =
    result === "confirmed" ? [] : batch.items.slice(1).map((item) => item.outboxId);
  void handleShanbayMessage(
    {
      batchToken: batch.token,
      confirmedOutboxIds,
      failedOutboxIds,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/shanbay-resolve",
    },
    { url: "https://web.shanbay.com/wordsweb/#/collection" },
    cloudShanbayBridge,
    async () => settings,
  )
    .then((response) =>
      setCloudStatus(
        response?.type === "store/shanbay-resolved" && response.accepted
          ? `shanbay-${result}`
          : "shanbay-rejected",
      ),
    )
    .catch(() => setCloudStatus("shanbay-failed"));
}

document.querySelector("[data-testid='cloud-confirm-shanbay']")?.addEventListener("click", () => {
  resolveShanbayBatch("confirmed");
});

document.querySelector("[data-testid='cloud-partial-shanbay']")?.addEventListener("click", () => {
  resolveShanbayBatch("partial");
});

class AnalysisPortPair {
  private readonly contentDisconnect: (() => void)[] = [];
  private readonly contentMessages: ((message: unknown) => void)[] = [];
  private disconnected = false;
  private readonly workerDisconnect: (() => void)[] = [];
  private readonly workerMessages: ((message: unknown) => void)[] = [];

  readonly content: ContentAnalysisPort = {
    disconnect: () => this.disconnect(),
    onDisconnect: { addListener: (listener) => this.contentDisconnect.push(listener) },
    onMessage: { addListener: (listener) => this.contentMessages.push(listener) },
    postMessage: (message) => queueMicrotask(() => this.emit(this.workerMessages, message)),
  };

  readonly worker: AnalysisSessionPort = {
    onDisconnect: { addListener: (listener) => this.workerDisconnect.push(listener) },
    onMessage: { addListener: (listener) => this.workerMessages.push(listener) },
    postMessage: (message) => queueMicrotask(() => this.emit(this.contentMessages, message)),
  };

  private disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.emit(this.workerDisconnect);
    this.emit(this.contentDisconnect);
  }

  private emit<Argument>(
    listeners: readonly ((argument: Argument) => void)[],
    argument?: Argument,
  ): void {
    if (this.disconnected && argument !== undefined) return;
    for (const listener of listeners) listener(argument as Argument);
  }
}

function connectAnalysis(): ContentAnalysisPort {
  const pair = new AnalysisPortPair();
  createAnalysisSession(pair.worker, {
    analysisEngine: queryEngine,
    createRequestId: () => `store-e2e-request-${++requestSequence}`,
    getSettings: async () => settings,
    siteHost: siteHostFromSenderUrl(senderUrl),
  });
  return pair.content;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function sendMessage(value: unknown): Promise<unknown> {
  const message = asRecord(value);
  if (message.type === "store/handshake") {
    return {
      compatible: true,
      extensionVersion: "1.0.0-e2e",
      messageVersion: STORE_MESSAGE_VERSION,
      requestId: message.requestId,
      type: "store/handshake-result",
    };
  }
  if (message.type === "store/site-policy") {
    window.setTimeout(() => {
      document.documentElement.dataset.storeCloudHarnessReady = "true";
    }, 0);
    return {
      defaultAction: "ask",
      enabled: true,
      globallyEnabled: true,
      host: window.location.hostname,
      messageVersion: STORE_MESSAGE_VERSION,
      overlayTheme: "pearl",
      type: "store/site-policy-result",
    };
  }
  if (typeof message.type === "string" && message.type.startsWith("store/local-word-import-")) {
    const response = await localWordImportRuntime.handle(
      value,
      { id: extensionId, url: `chrome-extension://${extensionId}/options.html` },
      extensionId,
    );
    if (response !== undefined) return response;
  }
  if (typeof message.type === "string" && message.type.startsWith("store/lexicon-")) {
    const response = await handleLexiconMessage(
      value,
      localLexicon,
      undefined,
      async () => settings,
      senderUrl,
      cloudWordCopy,
    );
    setCloudStatus(`local:${localWords.size}`);
    return response;
  }
  const studyCapture = await handleStudyCaptureMessage(value, {
    api: studyCaptureApi,
    createIdempotencyKey: () =>
      `store-e2e-${clientNamespace}-undo-${String(++idempotencySequence).padStart(8, "0")}`,
    outbox,
    preferences: { sync: async () => preferences },
    runtimeId: extensionId,
    scheduleRetry: () => setCloudStatus("queued"),
    sender: { id: extensionId, url: senderUrl },
    sessionVault,
  });
  if (studyCapture !== undefined) {
    setCloudStatus(studyCapture.outcome);
    return studyCapture;
  }
  throw new Error("The Cloud Store harness received an unexpected runtime message.");
}

Reflect.set(globalThis, "chrome", {
  runtime: {
    connect: ({ name }: { name: string }) => {
      if (name !== STORE_ANALYSIS_PORT_NAME) throw new Error("Unexpected Store port.");
      return connectAnalysis();
    },
    getURL: (path: string) => `/apps/store-extension/dist/${path}`,
    id: extensionId,
    onMessage: {
      addListener: (listener: RuntimeListener) => runtimeListeners.push(listener),
    },
    sendMessage,
  },
});

let optionsController: LocalWordImportOptionsController | null = null;
if (localWordImportFixture) {
  setCloudStatus(`local:${localWords.size}`);
  optionsController = new LocalWordImportOptionsController({
    confirmImport: (wordCount, contextCount) =>
      window.confirm(`确认导入 ${wordCount} 个词条、${contextCount} 条语境？`),
    sendMessage,
  });
  const controller = optionsController;
  await controller.initialize(true);
  const runAlarm = document.querySelector<HTMLButtonElement>(
    "[data-testid='cloud-run-import-alarm']",
  );
  if (runAlarm !== null) {
    runAlarm.hidden = false;
    runAlarm.addEventListener("click", () => {
      void localWordImportRuntime
        .runAlarm()
        .then(() => controller.setReady(true))
        .catch(() => setCloudStatus("import-failed"));
    });
  }
}

if (eudicImportFixture && optionsController !== null) {
  const controller = optionsController;
  const runEudicImport = document.querySelector<HTMLButtonElement>(
    "[data-testid='cloud-run-eudic-import']",
  );
  if (runEudicImport !== null) {
    runEudicImport.hidden = false;
    runEudicImport.addEventListener("click", () => {
      void localWordbookEngine
        .startEudicImport()
        .then(() => localWordbookEngine.processEudicImportOnce())
        .then(() => controller.setReady(true))
        .then(() => setCloudStatus(`local:${localWords.size}`))
        .catch(() => setCloudStatus("eudic-import-failed"));
    });
  }
}

const packagedContentScript = document.createElement("script");
packagedContentScript.src = "/apps/store-extension/dist/content-script.js";
document.head.append(packagedContentScript);
