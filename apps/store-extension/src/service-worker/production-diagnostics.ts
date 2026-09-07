import { createDiagnosticOutbox } from "./diagnostic-outbox.js";
import {
  DIAGNOSTIC_CONSENT_KEY,
  DIAGNOSTIC_OUTBOX_KEY,
  diagnosticConsentId,
} from "./diagnostic-settings.js";
import type { ExtensionSessionVault } from "./extension-session-vault.js";

const alarmName = "huayi.store.diagnostics.retry";
export function createProductionStoreDiagnostics(
  apiOrigin: string | null,
  sessionVault: Pick<ExtensionSessionVault, "readSession">,
  clientVersion: string,
) {
  let origin: URL | undefined;
  if (apiOrigin) {
    const parsed = new URL(apiOrigin);
    if (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash
    )
      origin = parsed;
  }
  const storage = chrome.storage.local;
  let scheduledAt = 0;
  const outbox = createDiagnosticOutbox({
    crypto: globalThis.crypto,
    storage: {
      read: async () =>
        (await storage.get(DIAGNOSTIC_OUTBOX_KEY))[DIAGNOSTIC_OUTBOX_KEY] as unknown,
      write: (state) => storage.set({ [DIAGNOSTIC_OUTBOX_KEY]: state }),
      clear: () => storage.remove(DIAGNOSTIC_OUTBOX_KEY),
    },
    consent: async () =>
      origin
        ? diagnosticConsentId((await storage.get(DIAGNOSTIC_CONSENT_KEY))[DIAGNOSTIC_CONSENT_KEY])
        : null,
    session: () => sessionVault.readSession(),
    async upload(events, token, signal) {
      if (!origin) return 403;
      const response = await fetch(new URL("/v1/diagnostics", origin), {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `HuayiExtension ${token}`,
          "X-Huayi-Client-Version": clientVersion,
        },
        body: JSON.stringify({ consentVersion: 1, events }),
      });
      await response.body?.cancel();
      return response.status;
    },
    schedule: (when) => {
      if (scheduledAt && scheduledAt <= when) return;
      scheduledAt = when;
      void chrome.alarms.create(alarmName, { when }).catch(() => {
        scheduledAt = 0;
      });
    },
  });
  const flush = () => {
    void outbox.flush().catch(() => undefined);
  };
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === alarmName) {
      scheduledAt = 0;
      flush();
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area !== "local" ||
      !(DIAGNOSTIC_CONSENT_KEY in changes || "huayi.store.cloud.session" in changes)
    )
      return;
    outbox.cancel();
    flush();
  });
  flush();
  return outbox;
}
