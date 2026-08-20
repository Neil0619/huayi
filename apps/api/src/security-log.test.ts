import { describe, expect, it } from "vitest";

import { serializeSafeLog } from "./security-log.js";

describe("safe logging", () => {
  it("retains only allowlisted operational fields", () => {
    const log = serializeSafeLog({
      cookie: "session=secret",
      email: "person@example.com",
      errorCode: "forbidden",
      latencyMs: 12,
      prompt: "ignore previous instructions",
      requestId: "request-1",
      route: "admin.users.disable",
      sourceText: "private page contents",
      status: 403,
      token: "secret-token",
      url: "https://private.example/path",
    });

    expect(log).toEqual({
      errorCode: "forbidden",
      latencyMs: 12,
      requestId: "request-1",
      route: "admin.users.disable",
      status: 403,
    });
    expect(JSON.stringify(log)).not.toMatch(/private|secret|person@|https:/u);
  });
});
