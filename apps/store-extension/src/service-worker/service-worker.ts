import {
  STORE_ANALYSIS_PORT_NAME,
  STORE_MESSAGE_VERSION,
  parseStoreOpenOptionsRequest,
} from "@huayi/store-domain";

import { createProductionAnalysisEngine } from "../analysis/production-analysis-engine.js";
import { createProductionLexiconRepository } from "../lexicon/browser-lexicon-repository.js";
import { createProductionDeviceVault } from "../vault/browser-device-vault.js";
import { createProductionWordbookExportEngine } from "../wordbook/production-wordbook-export-engine.js";
import { createAnalysisSession } from "./analysis-session.js";
import {
  handleContentSettingsMessage,
  isContentSettingsMessage,
} from "./content-settings-handler.js";
import { handleLexiconMessage, isStoreLexiconMessage } from "./lexicon-message-handler.js";
import { handlePopupStatusMessage, isPopupStatusMessage } from "./popup-status-handler.js";
import { createChromeStoreSettings } from "./store-settings.js";
import { handleStoreMessage } from "./store-message-handler.js";
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
import { handleWordbookMessage } from "./wordbook-message-handler.js";
import {
  EUDIC_EXPORT_ALARM,
  EUDIC_IMPORT_ALARM,
  runEudicExportAlarm,
  runEudicImportAlarm,
  WORDBOOK_ALARM_DELAY_MS,
} from "./wordbook-alarm-runner.js";

const deviceVault = createProductionDeviceVault();
const analysisEngine = createProductionAnalysisEngine(deviceVault);
const storeSettings = createChromeStoreSettings(chrome.storage.local);
const lexiconRepository = createProductionLexiconRepository();
const wordbookExportEngine = createProductionWordbookExportEngine(deviceVault, lexiconRepository);
void deviceVault.ensureReady().catch(() => undefined);
void storeSettings.get().catch(() => undefined);

async function broadcastSettingsRefresh(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      typeof tab.id === "number"
        ? [
            chrome.tabs.sendMessage(tab.id, {
              messageVersion: STORE_MESSAGE_VERSION,
              type: "store/site-policy-refresh",
            }),
          ]
        : [],
    ),
  );
}

function scheduleWordbookAlarm(name: string): void {
  void chrome.alarms.create(name, { when: Date.now() + WORDBOOK_ALARM_DELAY_MS });
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
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
    void handleSitePolicyMessage(message, sender.url, storeSettings)
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  if (isStoreLexiconMessage(message)) {
    void handleLexiconMessage(
      message,
      lexiconRepository,
      wordbookExportEngine,
      () => storeSettings.get(),
      sender.url,
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
    void handleContentSettingsMessage(message, sender.url, () => storeSettings.get())
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }
  const type =
    typeof message === "object" && message !== null && "type" in message
      ? String(message.type)
      : "";
  if (
    type.startsWith("store/eudic-import-") ||
    type.startsWith("store/outbox-") ||
    type === "store/shanbay-page-ready" ||
    type === "store/shanbay-resolve"
  ) {
    void (async () =>
      (await handleShanbayMessage(message, sender, wordbookExportEngine, () =>
        storeSettings.get(),
      )) ??
      handleWordbookMessage(message, sender, chrome.runtime.id, wordbookExportEngine, () =>
        storeSettings.get(),
      ))()
      .then((response) => {
        if (response?.type === "store/eudic-import-result" && response.job.state === "running") {
          scheduleWordbookAlarm(EUDIC_IMPORT_ALARM);
        }
        if (response?.type === "store/outbox-process-result" && response.processed) {
          scheduleWordbookAlarm(EUDIC_EXPORT_ALARM);
        }
        sendResponse(response);
      })
      .catch(() =>
        sendResponse({
          code: "internal-error",
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/wordbook-error",
        }),
      );
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
  if (alarm.name === EUDIC_IMPORT_ALARM) {
    void runEudicImportAlarm(wordbookExportEngine, scheduleWordbookAlarm, () =>
      storeSettings.get(),
    ).catch(() => undefined);
  }
  if (alarm.name === EUDIC_EXPORT_ALARM) {
    void runEudicExportAlarm(wordbookExportEngine, scheduleWordbookAlarm, () =>
      storeSettings.get(),
    ).catch(() => undefined);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== STORE_ANALYSIS_PORT_NAME) return;
  createAnalysisSession(port, {
    analysisEngine,
    createRequestId: () => crypto.randomUUID(),
    getSettings: () => storeSettings.get(),
    siteHost: siteHostFromSenderUrl(port.sender?.url),
  });
});
