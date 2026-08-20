import { describe, expect, it } from "vitest";

import { STORE_MESSAGE_VERSION } from "./messages.js";
import { parseCloudSessionRequest, parseCloudSessionResponse } from "./cloud-session-messages.js";

describe("Store cloud-session messages", () => {
  it("accepts only parameter-free privileged commands", () => {
    expect(
      parseCloudSessionRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/cloud-session-start",
      }),
    ).toMatchObject({ type: "store/cloud-session-start" });
    expect(() =>
      parseCloudSessionRequest({
        analysisId: "analysis-1",
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/cloud-session-start",
        url: "https://attacker.invalid",
      }),
    ).toThrow();
  });

  it("keeps responses strict and free of pairing secrets or session tokens", () => {
    expect(
      parseCloudSessionResponse({
        expiresAt: "2026-08-13T01:00:00.000Z",
        messageVersion: STORE_MESSAGE_VERSION,
        status: "pairing",
        type: "store/cloud-session-result",
      }),
    ).toMatchObject({ status: "pairing" });
    expect(() =>
      parseCloudSessionResponse({
        messageVersion: STORE_MESSAGE_VERSION,
        sessionToken: "secret",
        status: "connected",
        type: "store/cloud-session-result",
      }),
    ).toThrow();
  });
});
