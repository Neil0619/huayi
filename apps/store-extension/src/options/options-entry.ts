import { STORE_MESSAGE_VERSION, parseStoreSitePoliciesChangedResponse } from "@huayi/store-domain";

import { createProductionLexiconRepository } from "../lexicon/browser-lexicon-repository.js";
import { createChromeStoreSettings } from "../service-worker/store-settings.js";
import { createProductionDeviceVault } from "../vault/browser-device-vault.js";
import { createProductionWordbookExportEngine } from "../wordbook/production-wordbook-export-engine.js";
import { LexiconOptionsController } from "./lexicon-options-controller.js";
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
const wordbookOptions = new WordbookOptionsController({
  sendMessage: (message) => chrome.runtime.sendMessage(message),
  vault,
});

const page = new OptionsPage({
  lexiconOptions: {
    async initialize(ready) {
      await Promise.all([lexiconOptions.initialize(ready), wordbookOptions.initialize(ready)]);
    },
    async setReady(ready) {
      await Promise.all([lexiconOptions.setReady(ready), wordbookOptions.setReady(ready)]);
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
  settings: createChromeStoreSettings(chrome.storage.local),
  vault,
});

void page.initialize().catch(() => undefined);
