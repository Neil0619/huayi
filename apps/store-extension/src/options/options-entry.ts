import {
  STORE_MESSAGE_VERSION,
  parseStoreOpenWebWorkspaceResponse,
  parseStoreSitePoliciesChangedResponse,
  type StoreOpenWebWorkspaceRequest,
} from "@huayi/store-domain";

import { createProductionLexiconRepository } from "../lexicon/browser-lexicon-repository.js";
import { createChromeStoreAppearance } from "../service-worker/store-appearance.js";
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

const page = new OptionsPage({
  appearance: createChromeStoreAppearance(chrome.storage.local),
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
  openWebWorkspace: async () => {
    const message: StoreOpenWebWorkspaceRequest = {
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/open-web-workspace",
    };
    const response = parseStoreOpenWebWorkspaceResponse(await chrome.runtime.sendMessage(message));
    if (!response.opened) throw new Error("Web workspace is not configured.");
  },
  settings: createChromeStoreSettings(chrome.storage.local),
  vault,
});

void page.initialize().catch(() => undefined);
