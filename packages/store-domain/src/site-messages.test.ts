import { describe, expect, it } from "vitest";

import {
  STORE_MESSAGE_VERSION,
  parseStoreSitePolicyRequest,
  parseStoreSitePolicyResponse,
  parseStoreSitePoliciesChangedRequest,
  parseStoreSitePoliciesChangedResponse,
  parseStoreSiteRelayMessage,
} from "./index.js";

describe("Store site policy messages", () => {
  it("accepts only versioned host-free queries and toggles", () => {
    expect(
      parseStoreSitePolicyRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/site-policy",
      }),
    ).toEqual({ messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policy" });
    expect(
      parseStoreSitePolicyRequest({
        enabled: false,
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/site-toggle",
      }),
    ).toEqual({
      enabled: false,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/site-toggle",
    });
    expect(() =>
      parseStoreSitePolicyRequest({
        host: "example.com",
        messageVersion: STORE_MESSAGE_VERSION,
        overlayTheme: "pearl",
        type: "store/site-toggle",
      }),
    ).toThrow();
  });

  it("keeps the trusted Options broadcast host-free", () => {
    expect(
      parseStoreSitePoliciesChangedRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/site-policies-changed",
      }),
    ).toMatchObject({ type: "store/site-policies-changed" });
    expect(
      parseStoreSitePoliciesChangedResponse({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/site-policies-refreshed",
      }),
    ).toMatchObject({ type: "store/site-policies-refreshed" });
    expect(() =>
      parseStoreSitePoliciesChangedRequest({
        host: "example.com",
        messageVersion: STORE_MESSAGE_VERSION,
        overlayTheme: "pearl",
        type: "store/site-policies-changed",
      }),
    ).toThrow();
  });

  it("strictly separates popup relay and worker refresh messages", () => {
    expect(
      parseStoreSiteRelayMessage({
        enabled: false,
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/popup-site-toggle",
      }),
    ).toMatchObject({ enabled: false, type: "store/popup-site-toggle" });
    expect(
      parseStoreSiteRelayMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/site-policy-refresh",
      }),
    ).toMatchObject({ type: "store/site-policy-refresh" });
    expect(() =>
      parseStoreSiteRelayMessage({
        host: "example.com",
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/popup-site-policy",
      }),
    ).toThrow();
  });

  it("strictly parses a worker-derived policy response", () => {
    expect(
      parseStoreSitePolicyResponse({
        appearance: "moon",
        defaultAction: "explain",
        enabled: false,
        globallyEnabled: true,
        host: "example.com",
        messageVersion: STORE_MESSAGE_VERSION,
        overlayTheme: "pearl",
        type: "store/site-policy-result",
      }),
    ).toMatchObject({
      appearance: "moon",
      defaultAction: "explain",
      enabled: false,
      host: "example.com",
    });
    expect(() =>
      parseStoreSitePolicyResponse({
        appearance: "moon",
        defaultAction: "ask",
        enabled: true,
        globallyEnabled: true,
        host: "example.com",
        messageVersion: STORE_MESSAGE_VERSION,
        overlayTheme: "pearl",
        type: "store/site-policy-result",
        url: "https://example.com/private",
      }),
    ).toThrow();
    expect(() =>
      parseStoreSitePolicyResponse({
        appearance: "dark",
        defaultAction: "ask",
        enabled: true,
        globallyEnabled: true,
        host: "example.com",
        messageVersion: STORE_MESSAGE_VERSION,
        overlayTheme: "pearl",
        type: "store/site-policy-result",
      }),
    ).toThrow();
  });
});
