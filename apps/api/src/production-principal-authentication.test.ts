import { describe, expect, it, vi } from "vitest";

import { authenticateProductionPrincipalRequest } from "./production-principal-authentication.js";

const policy = {
  extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
  minSupportedExtensionVersion: "1.0.0",
};
const authorization = `HuayiExtension ${"s".repeat(43)}`;

function identity() {
  return {
    authenticateExtension: vi.fn(async () => ({ userId: "extension-user" })),
    authenticateWebMutation: vi.fn(async () => ({ userId: "web-user" })),
    authenticateWebSession: vi.fn(async () => ({ userId: "web-user" })),
  };
}

describe("production principal authentication", () => {
  it("requires fixed Origin and a supported client version before token authentication", async () => {
    const adapter = identity();
    await expect(
      authenticateProductionPrincipalRequest(
        adapter,
        {
          authorization,
          clientVersion: "1.0.0",
          origin: policy.extensionOrigin,
        },
        policy,
      ),
    ).resolves.toEqual({ kind: "extension", userId: "extension-user" });
    expect(adapter.authenticateExtension).toHaveBeenCalledOnce();

    for (const headers of [
      { authorization, clientVersion: "1.0.0" },
      {
        authorization,
        clientVersion: "1.0.0",
        origin: `chrome-extension://${"b".repeat(32)}`,
      },
    ]) {
      const rejected = identity();
      await expect(
        authenticateProductionPrincipalRequest(rejected, headers, policy),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(rejected.authenticateExtension).not.toHaveBeenCalled();
    }
  });

  it("rejects missing, malformed, or older clients without querying the session", async () => {
    for (const clientVersion of [undefined, "1.0", "0.9.9"]) {
      const adapter = identity();
      await expect(
        authenticateProductionPrincipalRequest(
          adapter,
          {
            authorization,
            ...(clientVersion === undefined ? {} : { clientVersion }),
            origin: policy.extensionOrigin,
          },
          policy,
        ),
      ).rejects.toMatchObject({ code: "client_upgrade_required" });
      expect(adapter.authenticateExtension).not.toHaveBeenCalled();
    }
  });

  it("compares numeric version components and preserves Web mutation proof", async () => {
    await expect(
      authenticateProductionPrincipalRequest(
        identity(),
        {
          authorization,
          clientVersion: "1.10.0",
          origin: policy.extensionOrigin,
        },
        { ...policy, minSupportedExtensionVersion: "1.2.0" },
      ),
    ).resolves.toMatchObject({ kind: "extension" });
    await expect(
      authenticateProductionPrincipalRequest(
        identity(),
        {
          cookie: "huayi_session=web-session",
          csrf: "csrf-token",
          method: "POST",
          origin: "https://app.huayi.example",
        },
        policy,
      ),
    ).resolves.toEqual({ kind: "web", userId: "web-user" });
  });
});
