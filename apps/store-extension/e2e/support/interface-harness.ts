import { STORE_MESSAGE_VERSION, type DeviceVault, type StoreAppearance } from "@huayi/store-domain";
import { OptionsPage } from "../../src/options/options-page.js";
import { initializeDiagnosticSettings } from "../../src/options/diagnostic-settings-control.js";
import { PopupPage } from "../../src/popup/popup-page.js";
import { CloudAccountControls } from "../../src/page-ui/cloud-account-controls.js";
import { createChromeStoreSettings } from "../../src/service-worker/store-settings.js";
import { LexiconOptionsController } from "../../src/options/lexicon-options-controller.js";
import { WordbookOptionsController } from "../../src/options/wordbook-options-controller.js";
import { initializeOptionsBackfillPanel } from "../../src/options/options-backfill-panel.js";
import { initializePopupBackfill } from "../../src/popup/popup-backfill-visibility.js";
import { initializePopupBackfillSettings } from "../../src/options/popup-backfill-settings-control.js";
import { createPopupBackfillPreferenceFixture } from "./popup-backfill-preference-fixture.js";
import optionsMarkup from "../../pages/options.html?raw";
import popupMarkup from "../../pages/popup.html?raw";

const query = new URL(location.href).searchParams;
const popupBackfillStorage = createPopupBackfillPreferenceFixture(
  query.has("backfill") && query.get("page") !== "options",
);
const mode = query.get("page") === "options" ? "options" : "popup";
const source = mode === "options" ? optionsMarkup : popupMarkup;
const parsed = new DOMParser().parseFromString(source, "text/html");
parsed.querySelectorAll("script").forEach((script) => script.remove());
parsed.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]").forEach((link) => {
  link.href = `/apps/store-extension/pages/${link.getAttribute("href")}`;
});
document.documentElement.innerHTML = parsed.documentElement.innerHTML;

let theme = (query.get("theme") ?? "silver") as StoreAppearance;
const appearance = {
  get: async () => theme,
  set: async (value: StoreAppearance) => {
    theme = value;
  },
};
let connected = query.get("session") ?? "connected";
let backfillReads = 0;
const sendMessage = async (message: unknown): Promise<unknown> => {
  const type = (message as { type: string }).type;
  if (type === "store/backfill-open")
    window.dispatchEvent(new CustomEvent("fixture-backfill-open", { detail: message }));
  if (type === "store/backfill-status" || type === "store/backfill-open") {
    if (type === "store/backfill-status") backfillReads += 1;
    if (query.has("slowBackfill") && backfillReads > 1)
      return new Promise<unknown>(() => undefined);
    return {
      status: {
        scopeId: "local",
        enabled: true,
        dailyHour: 8,
        revision: 1,
        pendingCount: Number(query.get("backfillCount") ?? 0),
        unresolvedCount: Number(query.get("backfillReviewCount") ?? 0),
        unknownCount: 0,
        lastCheckedAt: null,
      },
      shared: false,
      needsLocalMerge: false,
      checkError: null,
      incomplete: false,
      lastCheckedAt: "2026-09-15T00:00:00.000Z",
      checking: query.has("backfillChecking"),
    };
  }
  if (
    query.has("slowAccount") &&
    ["store/cloud-session-status", "store/submission-outbox-status"].includes(type)
  )
    return new Promise<unknown>(() => undefined);
  if (type === "store/cloud-session-start") connected = "pairing";
  if (type === "store/cloud-session-disconnect") connected = "disconnected";
  if (type.startsWith("store/cloud-session-"))
    return {
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/cloud-session-result",
      status: connected,
      ...(["connected", "pairing"].includes(connected)
        ? { expiresAt: "2030-01-01T00:00:00Z" }
        : {}),
    };
  if (type.startsWith("store/submission-outbox-")) {
    if (query.get("queue") === "error") throw new Error("offline fixture failure");
    return {
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/submission-outbox-result",
      outcome: "status",
      state: query.get("queue") === "pending" ? "queued" : "empty",
      ...(query.get("queue") === "pending"
        ? { count: 12, oldestQueuedAt: "2026-09-01T00:00:00.000Z" }
        : {}),
    };
  }
  return {
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/popup-status-result",
    appearance: theme,
    globallyEnabled: query.get("enabled") !== "false",
    modelConsentGranted: query.get("consent") !== "false",
    overlayTheme: "pearl",
    providerId: "deepseek",
  };
};

if (mode === "popup") {
  const container = document.querySelector("main");
  if (container)
    initializePopupBackfill({
      storage: popupBackfillStorage,
      container,
      sendMessage,
      subscribeProgress(callback) {
        window.addEventListener("fixture-backfill-progress", callback);
        return () => window.removeEventListener("fixture-backfill-progress", callback);
      },
    });
  const started = performance.now();
  const initialized = new PopupPage({
    appearance,
    sendRuntimeMessage: sendMessage,
    queryActiveTab: async () => ({ id: 1 }),
    openOptionsPage: async () => undefined,
    sendTabMessage: async () => ({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/site-policy-result",
      enabled: true,
      globallyEnabled: true,
      host: "wiki.ersoft.cn",
      appearance: theme,
      defaultAction: "translate",
      overlayTheme: "pearl",
    }),
  }).initialize();
  const measure = () => {
    if (
      document.querySelector<HTMLInputElement>("[data-global-enabled]")?.disabled === false &&
      document.querySelector<HTMLInputElement>("[data-site-enabled]")?.disabled === false
    )
      document.documentElement.dataset.controlsMs = String(performance.now() - started);
    else requestAnimationFrame(measure);
  };
  requestAnimationFrame(measure);
  if (!query.has("slowAccount")) await initialized;
} else {
  initializePopupBackfillSettings(document, popupBackfillStorage);
  if (query.has("backfill")) initializeOptionsBackfillPanel(document, { sendMessage });
  const values: Record<string, unknown> = {};
  await initializeDiagnosticSettings(document, {
    get: async (key) => ({ [key]: values[key] }),
    set: async (value) => {
      Object.assign(values, value);
    },
    remove: async (keys) => {
      for (const key of typeof keys === "string" ? [keys] : keys)
        Reflect.deleteProperty(values, key);
    },
  });
  const settings = createChromeStoreSettings({
    get: async (key) => ({ [key]: values[key] }),
    set: async (value) => {
      Object.assign(values, value);
    },
    setAccessLevel: async () => undefined,
  });
  await settings.grantNetworkConsent(new Date("2026-09-01"));
  for (let index = 0; index < 21; index++)
    await settings.upsertSiteRule({
      action: "block",
      hostname: `site${String(index).padStart(2, "0")}.example.com`,
      includeSubdomains: false,
    });
  const vault: DeviceVault = {
    deleteCredential: async () => undefined,
    ensureReady: async () => undefined,
    getDek: async () => new Uint8Array(32),
    getCredential: async () => null,
    getReadiness: async () => "ready",
    migrateLegacy: async () => undefined,
    setCredential: async () => undefined,
  };
  const lexicon = new LexiconOptionsController({
    clock: () => new Date("2026-09-01"),
    confirmDelete: () => false,
    files: { downloadText: async () => undefined },
    wordbook: { cancelEntry: async () => undefined },
    lexicon: {
      save: async () => {
        throw new Error("Fixture is read-only");
      },
      findByHeadword: async () => null,
      list: async () => ({ entries: [], nextCursor: null }),
      snapshot: async () => [],
      delete: async () => false,
      exportWordList: async () => "",
    },
  });
  const wordbook = new WordbookOptionsController({ cloudAuthority: true, sendMessage, vault });
  await new OptionsPage({
    appearance,
    settings,
    vault,
    lexiconOptions: {
      initialize: async (ready) => {
        await lexicon.initialize(ready);
        await wordbook.initialize(ready);
      },
      setReady: async (ready) => {
        await lexicon.setReady(ready);
        await wordbook.setReady(ready);
      },
    },
  }).initialize();
  await new CloudAccountControls({ sendMessage, reportError: () => undefined }).initialize();
}
document.documentElement.dataset.interfaceReady = "true";
