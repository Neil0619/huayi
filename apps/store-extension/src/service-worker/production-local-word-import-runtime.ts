import type { DeviceVault, LexiconRepository } from "@huayi/store-domain";

import type { CloudWordCopyApi } from "./cloud-word-copy-api.js";
import type { ExtensionSessionVault } from "./extension-session-vault.js";
import {
  LOCAL_WORD_IMPORT_ALARM,
  LOCAL_WORD_IMPORT_RETRY_DELAY_MS,
  runLocalWordImportAlarm,
} from "./local-word-import-alarm.js";
import { handleLocalWordImportMessage } from "./local-word-import-handler.js";
import { createLocalWordImporter } from "./local-word-importer.js";
import { createLocalWordImportVault } from "./local-word-import-vault.js";

interface PersistentStorage {
  deletePersistent(key: string): Promise<void>;
  readPersistent(key: string): Promise<unknown>;
  writePersistent(key: string, value: unknown): Promise<void>;
}

interface RuntimeOptions {
  readonly alarms: { create(name: string, info: { when: number }): Promise<void> };
  readonly api: CloudWordCopyApi | null;
  readonly clientVersion: string;
  readonly crypto: Crypto;
  readonly deviceVault: Pick<DeviceVault, "getDek">;
  readonly lexicon: Pick<LexiconRepository, "snapshot">;
  readonly sessionVault: Pick<ExtensionSessionVault, "clearSession" | "readSession">;
  readonly settings: { get(): Promise<{ networkConsent: unknown }> };
  readonly storage: PersistentStorage;
}

export function createProductionLocalWordImportRuntime(options: RuntimeOptions) {
  const vault = createLocalWordImportVault({
    crypto: options.crypto,
    deviceVault: options.deviceVault,
    storage: {
      delete: (key) => options.storage.deletePersistent(key),
      read: (key) => options.storage.readPersistent(key),
      write: (key, value) => options.storage.writePersistent(key, value),
    },
  });
  const scheduleRetry = () => {
    void options.alarms.create(LOCAL_WORD_IMPORT_ALARM, {
      when: Date.now() + LOCAL_WORD_IMPORT_RETRY_DELAY_MS,
    });
  };
  const importer = createLocalWordImporter({
    allowUpload: async () => (await options.settings.get()).networkConsent !== null,
    api: options.api,
    clientVersion: options.clientVersion,
    createIdempotencyKey: () => options.crypto.randomUUID(),
    crypto: options.crypto,
    lexicon: options.lexicon,
    now: () => new Date(),
    sessionVault: options.sessionVault,
    vault,
  });
  return {
    alarmName: LOCAL_WORD_IMPORT_ALARM,
    clear: vault.clear,
    handle(message: unknown, sender: chrome.runtime.MessageSender, runtimeId: string) {
      return handleLocalWordImportMessage(message, {
        importer,
        runtimeId,
        scheduleRetry,
        sender,
      });
    },
    runAlarm: () => runLocalWordImportAlarm(importer, scheduleRetry),
  };
}
