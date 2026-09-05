import { STORE_MESSAGE_VERSION, type DeviceVault, type StoreAppearance } from "@huayi/store-domain";
import { OptionsPage } from "../../src/options/options-page.js";
import { PopupPage } from "../../src/popup/popup-page.js";
import { CloudAccountControls } from "../../src/page-ui/cloud-account-controls.js";
import { createChromeStoreSettings } from "../../src/service-worker/store-settings.js";
import { LexiconOptionsController } from "../../src/options/lexicon-options-controller.js";
import { WordbookOptionsController } from "../../src/options/wordbook-options-controller.js";
import optionsMarkup from "../../pages/options.html?raw";
import popupMarkup from "../../pages/popup.html?raw";

const query = new URL(location.href).searchParams;
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
const sendMessage = async (message: unknown): Promise<unknown> => {
  const type = (message as { type: string }).type;
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
  const values: Record<string, unknown> = {};
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
