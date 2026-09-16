import {
  isSiteEnabled,
  recipientAccessDecision,
  type DeviceVault,
  type LexiconRepository,
} from "@huayi/store-domain";
import type { ExtensionSessionVault } from "../service-worker/extension-session-vault.js";
import type { createChromeStoreSettings } from "../service-worker/store-settings.js";
import { HUAYI_CLOUD_API_ORIGIN } from "../service-worker/cloud-build-profile.js";
import { SHANBAY_COLLECTION_URL } from "../service-worker/shanbay-message-handler.js";
import { createChromeVaultStorageAdapter } from "../vault/chrome-vault-storage.js";
import { StoreEudicClient } from "../wordbook/eudic-client.js";
import { backfillSessionIdentity } from "./backfill-snapshot.js";
import { createBackfillAuthority } from "./backfill-authority.js";
import { createBackfillCloudApi } from "./backfill-cloud-api.js";
import {
  BACKFILL_EUDIC_ALARM,
  BACKFILL_REFRESH_ALARM,
  nextBackfillMorning,
} from "./backfill-discovery.js";
import { createBackfillRuntime } from "./backfill-runtime.js";
import { findBackfillTab, isBackfillTab } from "./backfill-tab.js";
import { createBackfillVault } from "./backfill-vault.js";

export function createProductionBackfillRuntime(
  device: DeviceVault,
  session: ExtensionSessionVault,
  settings: ReturnType<typeof createChromeStoreSettings>,
  lexicon: LexiconRepository,
) {
  const storage = createChromeVaultStorageAdapter(chrome.storage);
  const vault = createBackfillVault(device, {
    read: (key) => storage.readPersistent(key),
    write: (key, value) => storage.writePersistent(key, value),
    delete: (key) => storage.deletePersistent(key),
  });
  const authority = createBackfillAuthority({
    vault,
    session,
    api: HUAYI_CLOUD_API_ORIGIN
      ? createBackfillCloudApi(HUAYI_CLOUD_API_ORIGIN, chrome.runtime.getManifest().version)
      : null,
    lock: async (operation) => await navigator.locks.request("huayi-shanbay-backfill", operation),
  });
  const runtime = createBackfillRuntime({
    authority,
    runtimeId: chrome.runtime.id,
    discovery: {
      lexicon,
      eudic: new StoreEudicClient({
        authorization: () => device.getCredential("eudic-authorization"),
      }),
      allowEudic: async () =>
        recipientAccessDecision(await settings.get(), "eudic") === "allowed" &&
        (await device.getCredential("eudic-authorization")) !== null,
    },
    allowPage: async () => {
      const current = await settings.get();
      return (
        recipientAccessDecision(current, "shanbay") === "allowed" &&
        isSiteEnabled(current, "web.shanbay.com")
      );
    },
    grantConsent: async () => {
      await settings.grantRecipientConsent("shanbay", new Date());
      await settings.setRecipientEnabled("shanbay", true);
    },
    openTab: async () => {
      const tab = await findBackfillTab();
      if (tab?.id !== undefined) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId !== undefined)
          await chrome.windows.update(tab.windowId, { focused: true });
        return tab.id;
      }
      const created = await chrome.tabs.create({ url: SHANBAY_COLLECTION_URL, active: true });
      if (created.id === undefined) throw new Error("无法打开扇贝页面。");
      return created.id;
    },
    activateTab: async (tabId, view) => {
      if (!(await isBackfillTab(tabId)))
        await chrome.tabs.update(tabId, { url: SHANBAY_COLLECTION_URL });
      else
        void chrome.tabs
          .sendMessage(tabId, { type: "store/backfill-activate", ...(view ? { view } : {}) })
          .catch(() => undefined);
    },
    setBadge: async (text) => {
      await chrome.action.setBadgeText({ text });
      await chrome.action.setBadgeBackgroundColor({ color: text === "!" ? "#ad4a28" : "#315c50" });
    },
    scheduleMore: async (delayInMinutes = 0.5) => {
      await chrome.alarms.create(BACKFILL_REFRESH_ALARM, {
        when: Date.now() + delayInMinutes * 60_000,
        periodInMinutes: 15,
      });
    },
  });
  const schedule = async () => {
    await chrome.alarms.create(BACKFILL_EUDIC_ALARM, { when: nextBackfillMorning(new Date()) });
    if (!(await chrome.alarms.get(BACKFILL_REFRESH_ALARM)))
      await chrome.alarms.create(BACKFILL_REFRESH_ALARM, {
        delayInMinutes: 15,
        periodInMinutes: 15,
      });
  };
  let sessionIdentity: string | undefined;
  const initialize = async () => {
    const identity = await backfillSessionIdentity(await session.readSession());
    if (identity === sessionIdentity) return;
    const changed = sessionIdentity !== undefined;
    sessionIdentity = identity;
    const saved = await authority.readSnapshot();
    const due =
      saved.status.enabled &&
      !saved.needsLocalMerge &&
      (saved.lastCheckedAt === null || Date.now() - Date.parse(saved.lastCheckedAt) >= 15 * 60_000);
    // A popup can wake an idle MV3 worker. A recent bound cache needs no discovery.
    if (!changed && !saved.initializing && !saved.checking && !due) return;
    // New account binding must not wait for the previous account's detached source read.
    if (saved.initializing) await authority.run(async () => undefined);
    await runtime.refresh();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("huayi.store.cloud.session" in changes)) return;
    void initialize().catch(() => undefined);
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (![BACKFILL_EUDIC_ALARM, BACKFILL_REFRESH_ALARM].includes(alarm.name)) return;
    void runtime.refresh().finally(schedule);
  });
  chrome.runtime.onStartup.addListener(() => {
    void runtime.refresh().finally(schedule);
  });
  chrome.runtime.onInstalled.addListener(() => {
    void schedule();
  });
  void schedule()
    .then(initialize)
    .catch(() => undefined);
  return runtime;
}
