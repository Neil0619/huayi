import { describe, expect, it, vi } from "vitest";

import { installTimedTextCapture } from "./youtube-bridge-capture.js";
import { YOUTUBE_BRIDGE_REQUEST } from "./youtube-bridge-contract.js";

describe("installTimedTextCapture", () => {
  it("never breaks a page XHR that completes with a null-body status", async () => {
    class EmptyResponseXMLHttpRequest extends EventTarget {
      responseText = "";
      responseType: XMLHttpRequestResponseType = "";
      status = 204;

      open(): void {
        // The capture wrapper records the URL before delegating to this transport stub.
      }

      send(): void {
        this.dispatchEvent(new Event("loadend"));
      }
    }

    const environment = {
      fetch,
      XMLHttpRequest: EmptyResponseXMLHttpRequest as unknown as typeof XMLHttpRequest,
      setTimeout,
      clearTimeout,
    };
    const capture = installTimedTextCapture(
      environment,
      {
        type: YOUTUBE_BRIDGE_REQUEST,
        requestId: "source-empty-xhr",
        generation: 1,
        expectedVideoId: "video-1",
        target: "source",
      },
      { languageCode: "en", kind: "asr" },
      100,
    );
    const captureResult = expect(capture.result).rejects.toBe("invalid-response");
    const xhr = new environment.XMLHttpRequest();
    xhr.open(
      "GET",
      "https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&fmt=json3&pot=token",
    );

    expect(() => xhr.send()).not.toThrow();
    await captureResult;
    capture.restore();
  });

  it("never breaks the page fetch when cloning the response fails", async () => {
    const response = new Response("page response");
    response.clone = vi.fn(() => {
      throw new TypeError("locked body");
    });
    const originalFetch = vi.fn(async () => response);
    const environment = {
      fetch: originalFetch as typeof fetch,
      XMLHttpRequest,
      setTimeout,
      clearTimeout,
    };
    const capture = installTimedTextCapture(
      environment,
      {
        type: YOUTUBE_BRIDGE_REQUEST,
        requestId: "source-1",
        generation: 1,
        expectedVideoId: "video-1",
        target: "source",
      },
      { languageCode: "en", kind: "asr" },
      1,
    );
    const captureResult = expect(capture.result).rejects.toBe("timeout");

    await expect(
      environment.fetch(
        "https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&fmt=json3",
      ),
    ).resolves.toBe(response);
    await captureResult;
    capture.restore();
  });
});
