import type { DeviceVault, LexiconRepository, WordbookExportEngine } from "@huayi/store-domain";

import { createProductionDeviceDekSource } from "../lexicon/device-dek-source.js";
import { createBrowserWordbookExportEngine } from "./browser-wordbook-export-engine.js";
import { createEncryptedWordbookStateStore } from "./encrypted-wordbook-state-store.js";
import { StoreEudicClient } from "./eudic-client.js";

export const PRODUCTION_WORDBOOK_DATABASE_NAME = "huayi-store-wordbook";
export const PRODUCTION_WORDBOOK_LEASE_MS = 2 * 60 * 1_000;

export function createProductionWordbookExportEngine(
  deviceVault: DeviceVault,
  lexicon: LexiconRepository,
): WordbookExportEngine {
  return createBrowserWordbookExportEngine({
    clock: () => new Date(),
    eudic: new StoreEudicClient({
      authorization: () => deviceVault.getCredential("eudic-authorization"),
    }),
    leaseDurationMs: PRODUCTION_WORDBOOK_LEASE_MS,
    lexicon,
    randomId: () => globalThis.crypto.randomUUID(),
    stateStore: createEncryptedWordbookStateStore({
      crypto: globalThis.crypto,
      databaseName: PRODUCTION_WORDBOOK_DATABASE_NAME,
      dekSource: createProductionDeviceDekSource(),
      indexedDB: globalThis.indexedDB,
    }),
  });
}
