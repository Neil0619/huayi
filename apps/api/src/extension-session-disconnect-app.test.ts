import { describe, expect, it, vi } from "vitest";

import { createExtensionSessionDisconnectApp } from "./extension-session-disconnect-app.js";
import { CloudFault } from "./cloud-fault.js";

const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
const token = "t".repeat(43);

describe("Extension session disconnect HTTP adapter", () => {
  const appWithErrors = (revoke: (token: string) => Promise<void>) => {
    const app = createExtensionSessionDisconnectApp({ extensionOrigin, revoke });
    app.onError((error, context) => context.body(null, error instanceof CloudFault ? 403 : 500));
    return app;
  };

  it("revokes only the presented current token and returns no state", async () => {
    const revoke = vi.fn(async () => undefined);
    const app = appWithErrors(revoke);
    const response = await app.request("/v1/extension-session", {
      headers: {
        authorization: `HuayiExtension ${token}`,
        origin: extensionOrigin,
        "x-huayi-client-version": "0.1.0",
      },
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
    expect(revoke).toHaveBeenCalledWith(token);
  });

  it("rejects malformed proof before touching the revocation port", async () => {
    const revoke = vi.fn();
    const app = appWithErrors(revoke);
    for (const headers of [
      { authorization: `HuayiExtension ${token}`, "x-huayi-client-version": "1.0.0" },
      {
        authorization: `Bearer ${token}`,
        origin: extensionOrigin,
        "x-huayi-client-version": "1.0.0",
      },
      {
        authorization: `HuayiExtension ${token}`,
        origin: extensionOrigin,
        "x-huayi-client-version": "1.0",
      },
      {
        authorization: `HuayiExtension ${token}`,
        cookie: "huayi_session=forbidden",
        origin: extensionOrigin,
        "x-huayi-client-version": "1.0.0",
      },
    ]) {
      expect(
        (
          await app.request("/v1/extension-session", {
            headers,
            method: "DELETE",
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await app.request("/v1/extension-session", {
          body: "{}",
          headers: {
            authorization: `HuayiExtension ${token}`,
            origin: extensionOrigin,
            "x-huayi-client-version": "1.0.0",
          },
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("accepts a bodyless DELETE represented as an empty Node request stream", async () => {
    const revoke = vi.fn(async () => undefined);
    const app = appWithErrors(revoke);
    const init = {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      duplex: "half",
      headers: {
        authorization: `HuayiExtension ${token}`,
        origin: extensionOrigin,
        "x-huayi-client-version": "1.0.0",
      },
      method: "DELETE",
    };
    const request = new Request("http://localhost/v1/extension-session", init);
    expect(request.body).not.toBeNull();
    const response = await app.request(request);
    expect(response.status).toBe(204);
    expect(revoke).toHaveBeenCalledWith(token);
  });

  it("rejects body bytes even when content length claims zero", async () => {
    const revoke = vi.fn();
    const app = appWithErrors(revoke);
    const response = await app.request("/v1/extension-session", {
      body: "{}",
      headers: {
        authorization: `HuayiExtension ${token}`,
        "content-length": "0",
        origin: extensionOrigin,
        "x-huayi-client-version": "1.0.0",
      },
      method: "DELETE",
    });
    expect(response.status).toBe(403);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("rejects and cancels a nonempty stream without waiting for its end", async () => {
    const revoke = vi.fn();
    const cancel = vi.fn();
    const app = appWithErrors(revoke);
    const init = {
      body: new ReadableStream<Uint8Array>({
        cancel,
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
        },
      }),
      duplex: "half",
      headers: {
        authorization: `HuayiExtension ${token}`,
        origin: extensionOrigin,
        "x-huayi-client-version": "1.0.0",
      },
      method: "DELETE",
    };
    const response = await app.request(new Request("http://localhost/v1/extension-session", init));
    expect(response.status).toBe(403);
    expect(revoke).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds an unfinished body stream without revoking a session", async () => {
    vi.useFakeTimers();
    try {
      const revoke = vi.fn();
      const cancel = vi.fn();
      const app = appWithErrors(revoke);
      const init = {
        body: new ReadableStream<Uint8Array>({ cancel }),
        duplex: "half",
        headers: {
          authorization: `HuayiExtension ${token}`,
          origin: extensionOrigin,
          "x-huayi-client-version": "1.0.0",
        },
        method: "DELETE",
      };
      let response: Response | undefined;
      void Promise.resolve(
        app.request(new Request("http://localhost/v1/extension-session", init)),
      ).then((value) => {
        response = value;
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(response?.status).toBe(403);
      expect(revoke).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
