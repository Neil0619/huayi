import {
  STORE_MESSAGE_VERSION,
  parseStoreOpenWebWorkspaceResponse,
  parseStoreSitePoliciesChangedResponse,
  type StoreOpenWebWorkspaceRequest,
} from "@huayi/store-domain";

import { createProductionLexiconRepository } from "../lexicon/browser-lexicon-repository.js";
import {
  createChromeStoreAppearance,
  STORE_APPEARANCE_STORAGE_KEY,
} from "../service-worker/store-appearance.js";
import { CloudAccountControls } from "../page-ui/cloud-account-controls.js";
import { subscribeToCloudSession } from "../page-ui/cloud-session-updates.js";
import { createChromeStoreSettings } from "../service-worker/store-settings.js";
import { createProductionDeviceVault } from "../vault/browser-device-vault.js";
import { createProductionWordbookExportEngine } from "../wordbook/production-wordbook-export-engine.js";
import { LexiconOptionsController } from "./lexicon-options-controller.js";
import { LocalWordImportOptionsController } from "./local-word-import-options-controller.js";
import { OptionsPage } from "./options-page.js";
import { createBrowserTextFileAdapter } from "./text-file-adapter.js";
import { WordbookOptionsController } from "./wordbook-options-controller.js";

const vault = createProductionDeviceVault();
const lexicon = createProductionLexiconRepository();
const wordbook = createProductionWordbookExportEngine(vault, lexicon);
const files = createBrowserTextFileAdapter({ document, url: URL });
const lexiconOptions = new LexiconOptionsController({
  clock: () => new Date(),
  confirmDelete: (headword) =>
    window.confirm(`仅从本地删除“${headword}”？欧路或扇贝中的远端数据不会被删除。`),
  files,
  lexicon,
  wordbook,
});
const localWordImportOptions = new LocalWordImportOptionsController({
  confirmImport: (wordCount, contextCount) =>
    window.confirm(
      `确认把 ${wordCount} 个本机词条、${contextCount} 条语境导入 Web？本机数据不会删除，Web 现有笔记不会被覆盖。`,
    ),
  sendMessage: (message) => chrome.runtime.sendMessage(message),
});
const wordbookOptions = new WordbookOptionsController({
  cloudAuthority: true,
  sendMessage: (message) => chrome.runtime.sendMessage(message),
  vault,
});

const appearance = createChromeStoreAppearance(chrome.storage.local);
const page = new OptionsPage({
  appearance,
  lexiconOptions: {
    async initialize(ready) {
      await Promise.all([
        lexiconOptions.initialize(ready),
        localWordImportOptions.initialize(ready),
        wordbookOptions.initialize(ready),
      ]);
    },
    async setReady(ready) {
      await Promise.all([
        lexiconOptions.setReady(ready),
        localWordImportOptions.setReady(ready),
        wordbookOptions.setReady(ready),
      ]);
    },
  },
  notifySitePolicyChanged: async () => {
    parseStoreSitePoliciesChangedResponse(
      await chrome.runtime.sendMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/site-policies-changed",
      }),
    );
  },
  openWebWorkspace: async (destination) => {
    const message: StoreOpenWebWorkspaceRequest = {
      ...(destination ? { destination } : {}),
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/open-web-workspace",
    };
    const response = parseStoreOpenWebWorkspaceResponse(await chrome.runtime.sendMessage(message));
    if (!response.opened) throw new Error("Web workspace is not configured.");
  },
  settings: createChromeStoreSettings(chrome.storage.local),
  vault,
});

const account = new CloudAccountControls({
  subscribe: subscribeToCloudSession,
  sendMessage: (message) => chrome.runtime.sendMessage(message),
  reportError: (message) => {
    const status = document.querySelector<HTMLElement>("[data-page-status]");
    if (status) {
      status.textContent = message;
      status.dataset.tone = "error";
    }
  },
});
void page
  .initialize()
  .finally(() => account.initialize())
  .catch(() => undefined);
const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
  if (area === "local" && STORE_APPEARANCE_STORAGE_KEY in changes) {
    void appearance.get().then((value) => page.refreshAppearance(value));
  }
};
chrome.storage.onChanged.addListener(onStorageChanged);
window.addEventListener(
  "pagehide",
  () => chrome.storage.onChanged.removeListener(onStorageChanged),
  { once: true },
);
