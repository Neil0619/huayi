import {
  STORE_ANALYSIS_PORT_NAME,
  STORE_MESSAGE_VERSION,
  parseCloudSessionRequest,
  parseStoreOpenOptionsRequest,
  recipientAccessDecision,
} from "@huayi/store-domain";

import { createProductionAnalysisEngine } from "../analysis/production-analysis-engine.js";
import { createProductionLexiconRepository } from "../lexicon/browser-lexicon-repository.js";
import { createProductionDeviceVault } from "../vault/browser-device-vault.js";
import { createChromeVaultStorageAdapter } from "../vault/chrome-vault-storage.js";
import { StoreEudicClient } from "../wordbook/eudic-client.js";
import { createAnalysisSession } from "./analysis-session.js";
import { analysisSourceTypeFromSenderUrl } from "./analysis-source-type.js";
import { createCloudSessionManager } from "./cloud-session-manager.js";
import { clearCloudAccountData } from "./cloud-account-data-clearer.js";
import { shouldRetryCloudWordbookRequest } from "./cloud-wordbook-api.js";
import { createCloudExternalWordbookBridge } from "./cloud-external-wordbook-bridge.js";
import { createCloudShanbayBridge } from "./cloud-shanbay-bridge.js";
import {
  CLOUD_PAIRING_POLL_ALARM,
  CLOUD_PAIRING_POLL_DELAY_MS,
  handleCloudSessionMessage,
} from "./cloud-session-handler.js";
import { createExtensionSessionVault } from "./extension-session-vault.js";
import { createExtensionPreferenceCache } from "./extension-preference-cache.js";
import { createExternalWordbookLeaseVault } from "./external-wordbook-lease-vault.js";
import { createProductionLocalWordImportRuntime } from "./production-local-word-import-runtime.js";
import { createSubmissionOutbox } from "./submission-outbox.js";
import {
  runSubmissionOutboxAlarm,
  SUBMISSION_OUTBOX_ALARM,
  SUBMISSION_OUTBOX_RETRY_DELAY_MS,
} from "./submission-outbox-alarm.js";
import { handleSubmissionOutboxMessage } from "./submission-outbox-handler.js";
import { createSubmissionOutboxVault } from "./submission-outbox-vault.js";
import { handleStudyCaptureMessage } from "./study-capture-handler.js";
import { createProductionCloudClients } from "./production-cloud-clients.js";
import { createCloudSubmissionApi } from "./cloud-submission-api.js";
import { createCloudWordCopyClient } from "./cloud-word-copy-client.js";
import { createProductionQueryEngine } from "./production-query-engine.js";
import { randomUrlSafeId } from "./random-url-safe-id.js";
import {
  handleContentSettingsMessage,
  isContentSettingsMessage,
} from "./content-settings-handler.js";
import { handleLexiconMessage, isStoreLexiconMessage } from "./lexicon-message-handler.js";
import { handlePopupStatusMessage, isPopupStatusMessage } from "./popup-status-handler.js";
import { broadcastSettingsRefresh } from "./settings-refresh-broadcaster.js";
import { createChromeStoreAppearance } from "./store-appearance.js";
import { createChromeStoreSettings } from "./store-settings.js";
import { handleStoreMessage } from "./store-message-handler.js";
import { HUAYI_WEB_WORKSPACE_URL, handleOpenWebWorkspace } from "./web-workspace-handler.js";
import { handleShanbayMessage } from "./shanbay-message-handler.js";
import {
  handleSitePolicyMessage,
  isSitePolicyMessage,
  siteHostFromSenderUrl,
} from "./site-policy-handler.js";
import {
  handleSitePoliciesChanged,
  isSitePoliciesChangedMessage,
} from "./site-policy-broadcaster.js";
import { EUDIC_EXPORT_ALARM, WORDBOOK_ALARM_DELAY_MS } from "./wordbook-alarm-runner.js";
const deviceVault = createProductionDeviceVault();
const analysisEngine = createProductionAnalysisEngine(deviceVault);
const storeAppearance = createChromeStoreAppearance(chrome.storage.local);
const storeSettings = createChromeStoreSettings(chrome.storage.local);
const lexiconRepository = createProductionLexiconRepository();
const HUAYI_CLOUD_API_ORIGIN: string | null = null;
const STORE_CLIENT_VERSION = chrome.runtime.getManifest().version;
const cloudClients = createProductionCloudClients(
  HUAYI_CLOUD_API_ORIGIN,
  STORE_CLIENT_VERSION,
  (input, init) => fetch(input, init),
);
const cloudSubmissionApi =
  cloudClients.studyCaptures === null || cloudClients.wordCopies === null
    ? null
    : createCloudSubmissionApi({
        studyCaptures: cloudClients.studyCaptures,
        wordCopies: cloudClients.wordCopies,
      });
const extensionSessionStorageAdapter = createChromeVaultStorageAdapter(chrome.storage);
const extensionSessionVault = createExtensionSessionVault({
  crypto: globalThis.crypto,
  deviceVault,
  storage: {
    delete: (key) => extensionSessionStorageAdapter.deletePersistent(key),
    read: (key) => extensionSessionStorageAdapter.readPersistent(key),
    write: (key, value) => extensionSessionStorageAdapter.writePersistent(key, value),
  },
});
const submissionOutboxVault = createSubmissionOutboxVault({
  crypto: globalThis.crypto,
  deviceVault,
  storage: {
    delete: (key) => extensionSessionStorageAdapter.deletePersistent(key),
    read: (key) => extensionSessionStorageAdapter.readPersistent(key),
    write: (key, value) => extensionSessionStorageAdapter.writePersistent(key, value),
  },
});
const externalWordbookLeaseVault = createExternalWordbookLeaseVault({
  crypto: globalThis.crypto,
  deviceVault,
  storage: {
    delete: (key) => extensionSessionStorageAdapter.deletePersistent(key),
    read: (key) => extensionSessionStorageAdapter.readPersistent(key),
    write: (key, value) => extensionSessionStorageAdapter.writePersistent(key, value),
  },
});
const submissionOutbox = createSubmissionOutbox({
  allowUpload: async () => (await storeSettings.get()).networkConsent !== null,
  api: cloudSubmissionApi,
  clientVersion: STORE_CLIENT_VERSION,
  createIdempotencyKey: () => crypto.randomUUID(),
  sessionVault: extensionSessionVault,
  vault: submissionOutboxVault,
});
const cloudWordbookApi = cloudClients.wordbooks;
const cloudWordbookBridge =
  cloudWordbookApi === null
    ? null
    : createCloudExternalWordbookBridge({
        allowTarget: async (target) =>
          recipientAccessDecision(await storeSettings.get(), target) === "allowed",
        api: cloudWordbookApi,
        eudic: new StoreEudicClient({
          authorization: () => deviceVault.getCredential("eudic-authorization"),
        }),
        idempotencyKey: () => crypto.randomUUID(),
        randomNonce: () => randomUrlSafeId(crypto),
        session: () => extensionSessionVault.readSession(),
      });
const cloudShanbayBridge =
  cloudWordbookApi === null
    ? null
    : createCloudShanbayBridge({
        allow: async () =>
          recipientAccessDecision(await storeSettings.get(), "shanbay") === "allowed",
        api: cloudWordbookApi,
        idempotencyKey: () => crypto.randomUUID(),
        randomId: () => randomUrlSafeId(crypto),
        sessionVault: extensionSessionVault,
        vault: externalWordbookLeaseVault,
      });
const cloudSessionManager = createCloudSessionManager({
  api: cloudClients.identity,
  clearSubmissions: clearAccountData,
  crypto: globalThis.crypto,
  open: async (url) => {
    await chrome.tabs.create({ url });
  },
  randomBytes: (length) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
  vault: extensionSessionVault,
  webOrigin: HUAYI_WEB_WORKSPACE_URL,
});
const extensionPreferenceCache = createExtensionPreferenceCache({
  api: cloudClients.identity,
  clearAccountData,
  vault: extensionSessionVault,
});
const cloudWordCopy = createCloudWordCopyClient({
  outbox: submissionOutbox,
  preferences: extensionPreferenceCache,
  scheduleRetry: scheduleSubmissionOutbox,
});
void deviceVault.ensureReady().catch(() => undefined);
void storeAppearance.get().catch(() => undefined);
void storeSettings.get().catch(() => undefined);
function scheduleWordbookAlarm(name: string): void {
  void chrome.alarms.create(name, { when: Date.now() + WORDBOOK_ALARM_DELAY_MS });
}
function scheduleCloudPairingPoll(): void {
  void chrome.alarms.create(CLOUD_PAIRING_POLL_ALARM, {
    when: Date.now() + CLOUD_PAIRING_POLL_DELAY_MS,
  });
}
function scheduleSubmissionOutbox(): void {
  void chrome.alarms.create(SUBMISSION_OUTBOX_ALARM, {
    when: Date.now() + SUBMISSION_OUTBOX_RETRY_DELAY_MS,
  });
}
const localWordImportRuntime = createProductionLocalWordImportRuntime({
  alarms: chrome.alarms,
  api: cloudClients.wordCopies,
  clientVersion: STORE_CLIENT_VERSION,
  crypto: globalThis.crypto,
  deviceVault,
  lexicon: lexiconRepository,
  sessionVault: extensionSessionVault,
  settings: storeSettings,
  storage: extensionSessionStorageAdapter,
});
async function clearAccountData(): Promise<void> {
  await clearCloudAccountData(submissionOutbox, externalWordbookLeaseVault, localWordImportRuntime);
}
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const messageType =
    typeof message === "object" && message !== null && "type" in message
      ? String(message.type)
      : "";
  if (messageType.startsWith("store/study-capture-")) {
    void handleStudyCaptureMessage(message, {
      api: cloudClients.studyCaptures,
      createIdempotencyKey: () => crypto.randomUUID(),
      outbox: submissionOutbox,
      preferences: extensionPreferenceCache,
      runtimeId: chrome.runtime.id,
      scheduleRetry: scheduleSubmissionOutbox,
      sender,
      sessionVault: extensionSessionVault,
    })
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  if (messageType.startsWith("store/submission-outbox-")) {
    void handleSubmissionOutboxMessage(message, {
      outbox: submissionOutbox,
      runtimeId: chrome.runtime.id,
      scheduleRetry: scheduleSubmissionOutbox,
      sender,
    })
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  if (messageType.startsWith("store/local-word-import-")) {
    void localWordImportRuntime
      .handle(message, sender, chrome.runtime.id)
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  if (messageType.startsWith("store/cloud-session-")) {
    try {
      parseCloudSessionRequest(message);
    } catch {
      return false;
    }
    void handleCloudSessionMessage(message, {
      manager: cloudSessionManager,
      runtimeId: chrome.runtime.id,
      schedulePoll: scheduleCloudPairingPoll,
      sender,
    })
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  if (messageType === "store/open-web-workspace") {
    void handleOpenWebWorkspace(
      message,
      sender.id,
      chrome.runtime.id,
      HUAYI_WEB_WORKSPACE_URL,
      (properties) => chrome.tabs.create(properties),
    )
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  if (isSitePoliciesChangedMessage(message)) {
    void handleSitePoliciesChanged(message, sender, chrome.runtime.id, async (refresh) => {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(
        tabs.flatMap((tab) =>
          typeof tab.id === "number" ? [chrome.tabs.sendMessage(tab.id, refresh)] : [],
        ),
      );
    })
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  if (isPopupStatusMessage(message)) {
    void handlePopupStatusMessage(message, sender, chrome.runtime.id, {
      getAppearance: () => storeAppearance.get(),
      getSettings: () => storeSettings.get(),
      notifySettingsChanged: broadcastSettingsRefresh,
      setGloballyEnabled: (enabled) => storeSettings.setGloballyEnabled(enabled),
      setOverlayTheme: (theme) => storeSettings.setOverlayTheme(theme),
    })
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  if (isSitePolicyMessage(message)) {
    void handleSitePolicyMessage(message, sender.url, storeSettings, () => storeAppearance.get())
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  if (isStoreLexiconMessage(message)) {
    void handleLexiconMessage(
      message,
      lexiconRepository,
      undefined,
      () => storeSettings.get(),
      sender.url,
      cloudWordCopy,
    )
      .then((response) => {
        if (response?.type === "store/lexicon-save-result") {
          scheduleWordbookAlarm(EUDIC_EXPORT_ALARM);
        }
        sendResponse(response);
      })
      .catch(() =>
        sendResponse({
          code: "internal-error",
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/lexicon-error",
        }),
      );
    return true;
  }
  if (isContentSettingsMessage(message)) {
    void handleContentSettingsMessage(
      message,
      sender.url,
      () => storeSettings.get(),
      () => storeAppearance.get(),
    )
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  if (
    cloudShanbayBridge !== null &&
    (messageType === "store/shanbay-page-ready" || messageType === "store/shanbay-resolve")
  ) {
    void handleShanbayMessage(message, sender, cloudShanbayBridge, () => storeSettings.get())
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  try {
    parseStoreOpenOptionsRequest(message);
    void chrome.runtime.openOptionsPage().catch(() => undefined);
    return false;
  } catch {
    // Continue with the separate strict handshake contract.
  }
  const response = handleStoreMessage(message, chrome.runtime.getManifest().version);
  if (response === undefined) return false;
  sendResponse(response);
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLOUD_PAIRING_POLL_ALARM) {
    void cloudSessionManager
      .continuePairing()
      .then((state) => {
        if (state.status === "pairing") scheduleCloudPairingPoll();
      })
      .catch(async () => {
        const state = await cloudSessionManager.status().catch(() => undefined);
        if (state?.status === "pairing") scheduleCloudPairingPoll();
      });
  }
  if (alarm.name === EUDIC_EXPORT_ALARM) {
    void cloudWordbookBridge
      ?.processOne()
      .then((processed) => {
        if (processed) scheduleWordbookAlarm(EUDIC_EXPORT_ALARM);
      })
      .catch((error: unknown) => {
        if (shouldRetryCloudWordbookRequest(error)) scheduleWordbookAlarm(EUDIC_EXPORT_ALARM);
      });
  }
  if (alarm.name === SUBMISSION_OUTBOX_ALARM) {
    void runSubmissionOutboxAlarm(submissionOutbox, scheduleSubmissionOutbox);
  }
  if (alarm.name === localWordImportRuntime.alarmName) {
    void localWordImportRuntime.runAlarm();
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== STORE_ANALYSIS_PORT_NAME) return;
  createAnalysisSession(port, {
    analysisEngine: createProductionQueryEngine({
      byok: analysisEngine,
      cloudApi: cloudClients.extensionQueries,
      preferences: extensionPreferenceCache,
      sessionVault: extensionSessionVault,
      sourceType: analysisSourceTypeFromSenderUrl(port.sender?.url),
    }),
    createRequestId: () => crypto.randomUUID(),
    getSettings: () => storeSettings.get(),
    siteHost: siteHostFromSenderUrl(port.sender?.url),
  });
});
