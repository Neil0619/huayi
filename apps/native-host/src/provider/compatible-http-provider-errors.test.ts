import { describe, expect, it } from "vitest";

import {
  compatibleHttpFetchError,
  compatibleHttpHttpError,
  compatibleHttpProviderError,
} from "./compatible-http-provider-errors.js";

describe("Compatible HTTP Provider errors", () => {
  it.each([
    [401, "MODEL_PROVIDER_AUTH_FAILED"],
    [403, "RATE_LIMITED"],
    [429, "RATE_LIMITED"],
    [502, "NETWORK_ERROR"],
    [503, "NETWORK_ERROR"],
    [504, "NETWORK_ERROR"],
    [400, "INVALID_RESPONSE"],
    [404, "INVALID_RESPONSE"],
    [500, "INVALID_RESPONSE"],
    [302, "INVALID_RESPONSE"],
  ] as const)("maps HTTP %i to %s", (status, code) => {
    expect(compatibleHttpHttpError(status)).toMatchObject({ code });
  });

  it("distinguishes cancellation, timeout, redirect rejection and network failure", () => {
    const failure = new TypeError("fetch failed: secret-host");
    expect(compatibleHttpFetchError(failure, "user")).toMatchObject({ code: "CANCELLED" });
    expect(compatibleHttpFetchError(failure, "timeout")).toMatchObject({ code: "TIMEOUT" });
    expect(compatibleHttpFetchError(failure, "none")).toMatchObject({ code: "NETWORK_ERROR" });
    expect(
      compatibleHttpFetchError(
        new TypeError("fetch failed", {
          cause: new Error("unexpected redirect to secret-host"),
        }),
        "none",
      ),
    ).toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("uses fixed safe messages without response, URL, selection or key contents", () => {
    const sentinels = [
      "secret-response-body",
      "http://secret-host.example/v1",
      "secret-selection",
      "secret-api-key",
    ];
    const error = compatibleHttpProviderError("INTERNAL_ERROR", new Error(sentinels.join(" ")));
    const rendered = [String(error), error.stack ?? "", JSON.stringify(error)].join("\n");

    expect(error.name).toBe("CompatibleHttpProviderError");
    for (const sentinel of sentinels) expect(rendered).not.toContain(sentinel);
  });
});
