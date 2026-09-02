import { describe, expect, it } from "vitest";

import {
  STORE_MESSAGE_VERSION,
  STORE_ANALYSIS_PORT_NAME,
  STORE_NETWORK_CONSENT_VERSION,
  STORE_RECIPIENT_CONSENT_VERSIONS,
  STORE_SETTINGS_SCHEMA_VERSION,
  contextObservationSchema,
  eudicImportJobSchema,
  exportOutboxItemSchema,
  parseAnalysisClientMessage,
  parseAnalysisServerMessage,
  parseStoreHandshakeRequest,
  parseStoreHandshakeResponse,
  parseStoreOpenWebWorkspaceRequest,
  parseStoreOpenWebWorkspaceResponse,
  parseStoreOpenOptionsRequest,
  parseStoreWordbookRequest,
  storeSettingsSchema,
  recipientAccessDecision,
  wordEntrySchema,
} from "./index.js";

describe("Store domain contracts", () => {
  it("uses the v5 runtime message boundary", () => {
    expect(STORE_MESSAGE_VERSION).toBe(5);
    expect(STORE_ANALYSIS_PORT_NAME).toBe("huayi-store-analysis-v5");
  });

  it("accepts a word with multiple bounded context observations", () => {
    const entry = {
      contexts: [
        {
          contextualMeaningZh: "维持",
          id: "context-1",
          observedAt: "2026-08-11T01:00:00.000Z",
          sentence: "They sustain the project.",
          source: "web",
        },
        {
          contextualMeaningZh: "承受",
          id: "context-2",
          observedAt: "2026-08-11T02:00:00.000Z",
          sentence: "The bridge sustained damage.",
          source: "youtube",
        },
      ],
      createdAt: "2026-08-11T01:00:00.000Z",
      headword: "sustain",
      id: "sustain",
      updatedAt: "2026-08-11T02:00:00.000Z",
    };

    expect(wordEntrySchema.parse(entry)).toEqual(entry);
    expect(() =>
      contextObservationSchema.parse({ ...entry.contexts[0], url: "https://example.com" }),
    ).toThrow();
  });

  it("preserves an Eudic source sentence without fabricating a contextual meaning", () => {
    const imported = {
      id: "context-eudic-1",
      observedAt: "2026-08-11T01:00:00.000Z",
      sentence: "A preserved Eudic context.",
      source: "eudic-import",
    };

    expect(contextObservationSchema.parse(imported)).toEqual(imported);
    expect(() =>
      contextObservationSchema.parse({ ...imported, contextualMeaningZh: "伪造释义" }),
    ).toThrow();
  });

  it("keeps export delivery state explicit and strict", () => {
    const item = {
      attemptCount: 1,
      createdAt: "2026-08-11T01:00:00.000Z",
      entryId: "sustain",
      id: "export-1",
      state: "queued",
      target: "eudic",
      updatedAt: "2026-08-11T01:00:00.000Z",
    };

    expect(exportOutboxItemSchema.parse(item)).toEqual(item);
    expect(() => exportOutboxItemSchema.parse({ ...item, target: "notion" })).toThrow();
    expect(() => exportOutboxItemSchema.parse({ ...item, rawCredential: "secret" })).toThrow();
  });

  it("models page 51 only as the terminal Eudic source-limit cursor", () => {
    const limited = {
      duplicateCount: 0,
      importedCount: 5_100,
      nextPage: 51,
      state: "source-limit-reached",
      updatedAt: "2026-08-11T01:00:00.000Z",
    };

    expect(eudicImportJobSchema.parse(limited)).toEqual(limited);
    expect(() => eudicImportJobSchema.parse({ ...limited, nextPage: 52 })).toThrow();
    expect(() =>
      eudicImportJobSchema.parse({ ...limited, nextPage: 51, state: "completed" }),
    ).toThrow();
  });

  it("rejects previous-version requests and models an explicit reload response", () => {
    expect(
      parseStoreHandshakeRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        requestId: "handshake-1",
        type: "store/handshake",
      }),
    ).toMatchObject({ messageVersion: STORE_MESSAGE_VERSION });
    expect(() =>
      parseStoreHandshakeRequest({
        messageVersion: 0,
        requestId: "handshake-1",
        type: "store/handshake",
      }),
    ).toThrow();
    expect(
      parseStoreHandshakeResponse({
        compatible: false,
        expectedMessageVersion: STORE_MESSAGE_VERSION,
        receivedMessageVersion: 0,
        requestId: "handshake-1",
        type: "store/handshake-result",
      }),
    ).toMatchObject({ compatible: false });
  });

  it("keeps analysis port messages versioned, strict, and free of network authority", () => {
    expect(
      parseAnalysisClientMessage({
        action: "translate",
        boundaryEvidence: { kind: "dom-sentence" },
        messageVersion: STORE_MESSAGE_VERSION,
        selection: "selected",
        sentenceContext: "The selected sentence.",
        type: "store/analysis-start",
      }),
    ).toMatchObject({ type: "store/analysis-start" });
    expect(
      parseAnalysisClientMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/analysis-cancel",
      }),
    ).toEqual({ messageVersion: STORE_MESSAGE_VERSION, type: "store/analysis-cancel" });
    expect(() =>
      parseAnalysisClientMessage({
        action: "translate",
        boundaryEvidence: { kind: "dom-sentence" },
        endpoint: "https://attacker.invalid",
        messageVersion: STORE_MESSAGE_VERSION,
        providerId: "openai",
        selection: "selected",
        sentenceContext: null,
        type: "store/analysis-start",
      }),
    ).toThrow();
    expect(() =>
      parseAnalysisClientMessage({
        action: "translate",
        boundaryEvidence: { kind: "dom-sentence" },
        messageVersion: 0,
        selection: "selected",
        sentenceContext: null,
        type: "store/analysis-start",
      }),
    ).toThrow();

    expect(
      parseAnalysisServerMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        result: {
          requestId: "trusted-1",
          selectionKind: "sentence",
          sourceText: "Hello world.",
          translationZh: "你好，世界。",
          type: "translate-passage",
        },
        type: "store/analysis-result",
      }),
    ).toMatchObject({ type: "store/analysis-result" });
    expect(() =>
      parseAnalysisServerMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        result: {
          requestId: "trusted-1",
          selectionKind: "sentence",
          sourceText: "Hello world.",
          translationZh: "你好，世界。",
          type: "translate-passage",
          url: "https://example.com/private",
        },
        type: "store/analysis-result",
      }),
    ).toThrow();
  });

  it("requires an explicit versioned first-network consent in persisted settings", () => {
    const settings = {
      defaultAction: "ask",
      globallyEnabled: true,
      networkConsent: {
        grantedAt: "2026-08-11T01:00:00.000Z",
        version: STORE_NETWORK_CONSENT_VERSION,
      },
      overlayTheme: "pearl",
      providerId: "deepseek",
      recipientAccess: {
        eudic: {
          consent: {
            grantedAt: "2026-08-11T01:00:00.000Z",
            version: STORE_RECIPIENT_CONSENT_VERSIONS.eudic,
          },
          enabled: true,
        },
        shanbay: { consent: null, enabled: false },
      },
      schemaVersion: STORE_SETTINGS_SCHEMA_VERSION,
      sitePolicy: { defaultAction: "allow", rules: [] },
      youtubeMode: "bilingual",
      youtubeShortcut: null,
    };
    const parsedSettings = storeSettingsSchema.parse(settings);
    expect(parsedSettings).toEqual(settings);
    expect(() =>
      storeSettingsSchema.parse({
        ...settings,
        networkConsent: { ...settings.networkConsent, version: 0 },
      }),
    ).toThrow();
    expect(() =>
      storeSettingsSchema.parse({ ...settings, endpoint: "https://example.com" }),
    ).toThrow();
    expect(recipientAccessDecision(parsedSettings, "eudic")).toBe("allowed");
    expect(recipientAccessDecision(parsedSettings, "shanbay")).toBe("consent-required");
    expect(
      recipientAccessDecision(
        {
          ...parsedSettings,
          recipientAccess: {
            ...parsedSettings.recipientAccess,
            eudic: {
              consent: { grantedAt: "2026-08-11T01:00:00.000Z", version: 0 },
              enabled: true,
            },
          },
        },
        "eudic",
      ),
    ).toBe("consent-required");
  });

  it("accepts only the authority-free open-options command", () => {
    expect(
      parseStoreOpenOptionsRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/open-options",
      }),
    ).toEqual({ messageVersion: STORE_MESSAGE_VERSION, type: "store/open-options" });
    expect(() =>
      parseStoreOpenOptionsRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/open-options",
        url: "https://attacker.invalid",
      }),
    ).toThrow();
  });

  it("accepts only the parameter-free Web workspace command", () => {
    expect(
      parseStoreOpenWebWorkspaceRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/open-web-workspace",
      }),
    ).toEqual({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/open-web-workspace",
    });
    for (const authority of [
      { url: "https://attacker.invalid" },
      { analysisId: "analysis-1" },
      { token: "secret" },
    ]) {
      expect(() =>
        parseStoreOpenWebWorkspaceRequest({
          ...authority,
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/open-web-workspace",
        }),
      ).toThrow();
    }
    expect(
      parseStoreOpenWebWorkspaceResponse({
        messageVersion: STORE_MESSAGE_VERSION,
        opened: false,
        reason: "not-configured",
        type: "store/open-web-workspace-result",
      }),
    ).toMatchObject({ opened: false, reason: "not-configured" });
    expect(() =>
      parseStoreOpenWebWorkspaceResponse({
        messageVersion: STORE_MESSAGE_VERSION,
        opened: true,
        type: "store/open-web-workspace-result",
        url: "https://attacker.invalid",
      }),
    ).toThrow();
  });

  it("keeps wordbook runtime messages versioned, authority-free, and strict", () => {
    expect(
      parseStoreWordbookRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/eudic-import-step",
      }),
    ).toMatchObject({ type: "store/eudic-import-step" });
    expect(() =>
      parseStoreWordbookRequest({
        authorization: "Bearer secret",
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/eudic-import-step",
      }),
    ).toThrow();
    expect(() =>
      parseStoreWordbookRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/shanbay-page-ready",
        url: "https://web.shanbay.com/wordsweb/#/collection",
      }),
    ).toThrow();
  });
});
