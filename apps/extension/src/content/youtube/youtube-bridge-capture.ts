import {
  MAX_TIMED_TEXT_BYTES,
  parseTimedTextBody,
  type YouTubeBridgeError,
  type YouTubeBridgeRequest,
  type YouTubeTimedTextFingerprint,
} from "./youtube-bridge-contract.js";

type TimerHandle = ReturnType<typeof setTimeout>;

interface CaptureEnvironment {
  fetch: typeof fetch;
  XMLHttpRequest: typeof XMLHttpRequest;
  setTimeout(handler: () => void, timeout: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

interface CaptureTrack {
  languageCode: string;
  kind?: string;
}

export interface CapturedTimedText {
  fingerprint: YouTubeTimedTextFingerprint;
  body: string;
}

export interface TimedTextCapture {
  result: Promise<CapturedTimedText>;
  cancel(error: YouTubeBridgeError): void;
  restore(): void;
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

function expectedFingerprint(
  urlValue: string,
  request: YouTubeBridgeRequest,
  track: CaptureTrack,
): YouTubeTimedTextFingerprint | null {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  const poToken = url.searchParams.get("pot");
  if (
    url.protocol !== "https:" ||
    !YOUTUBE_HOSTS.has(url.hostname) ||
    url.pathname !== "/api/timedtext" ||
    url.searchParams.get("v") !== request.expectedVideoId ||
    url.searchParams.get("lang") !== track.languageCode ||
    url.searchParams.get("fmt") !== "json3" ||
    (poToken !== null && (poToken.length === 0 || poToken.length > 4_096)) ||
    url.searchParams.get("kind") !== (track.kind ?? null) ||
    (request.target === "source"
      ? url.searchParams.has("tlang")
      : url.searchParams.get("tlang") !== "zh-Hans")
  ) {
    return null;
  }
  return {
    host: url.hostname as YouTubeTimedTextFingerprint["host"],
    path: "/api/timedtext",
    v: request.expectedVideoId,
    lang: track.languageCode,
    ...(track.kind === undefined ? {} : { kind: track.kind }),
    ...(request.target === "source" ? {} : { tlang: "zh-Hans" as const }),
    fmt: "json3",
  };
}

async function responseBody(response: Response): Promise<string | null> {
  if (!response.ok) return null;
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_TIMED_TEXT_BYTES) return null;
  }
  try {
    if (response.body === null) {
      const body = await response.text();
      return parseTimedTextBody(body) === null ? null : body;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_TIMED_TEXT_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = new TextDecoder().decode(bytes);
    return parseTimedTextBody(body) === null ? null : body;
  } catch {
    return null;
  }
}

export function installTimedTextCapture(
  environment: CaptureEnvironment,
  request: YouTubeBridgeRequest,
  track: CaptureTrack,
  timeoutMs: number,
): TimedTextCapture {
  let settled = false;
  let resolveResult: (value: CapturedTimedText) => void = () => undefined;
  let rejectResult: (reason: YouTubeBridgeError) => void = () => undefined;
  const result = new Promise<CapturedTimedText>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const settleResponse = async (url: string, response: Response): Promise<void> => {
    if (settled) return;
    const fingerprint = expectedFingerprint(url, request, track);
    if (fingerprint === null) return;
    const body = await responseBody(response);
    if (settled) return;
    if (body === null) {
      settled = true;
      rejectResult("invalid-response");
      return;
    }
    settled = true;
    resolveResult({ fingerprint, body });
  };

  const originalFetch = environment.fetch;
  const fetchWrapper: typeof fetch = async function (input, init) {
    const response = await originalFetch.call(environment, input, init);
    if (settled) return response;
    const url = input instanceof Request ? input.url : input.toString();
    try {
      void settleResponse(url, response.clone());
    } catch {
      // Capturing is best effort and must never change the page fetch result.
    }
    return response;
  };
  environment.fetch = fetchWrapper;

  const prototype = environment.XMLHttpRequest?.prototype;
  const originalOpen = prototype?.open;
  const originalSend = prototype?.send;
  const requestUrls = new WeakMap<XMLHttpRequest, string>();
  let openWrapper: typeof XMLHttpRequest.prototype.open | undefined;
  let sendWrapper: typeof XMLHttpRequest.prototype.send | undefined;
  if (prototype !== undefined && originalOpen !== undefined && originalSend !== undefined) {
    openWrapper = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...args: unknown[]
    ) {
      requestUrls.set(this, url.toString());
      return Reflect.apply(originalOpen, this, [method, url, ...args]);
    } as typeof XMLHttpRequest.prototype.open;
    sendWrapper = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      if (settled) return Reflect.apply(originalSend, this, [body]);
      this.addEventListener(
        "loadend",
        () => {
          const url = requestUrls.get(this);
          if (url === undefined || this.status < 200 || this.status >= 300) return;
          const text =
            this.responseType === "" || this.responseType === "text" ? this.responseText : null;
          if (text === null) return;
          try {
            const body = this.status === 204 || this.status === 205 ? null : text;
            void settleResponse(url, new Response(body, { status: this.status }));
          } catch {
            // Capturing is best effort and must never surface through the page XHR callback.
          }
        },
        { once: true },
      );
      return Reflect.apply(originalSend, this, [body]);
    } as typeof XMLHttpRequest.prototype.send;
    prototype.open = openWrapper;
    prototype.send = sendWrapper;
  }

  const timeout = environment.setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectResult("timeout");
  }, timeoutMs);

  return {
    result,
    cancel(error) {
      if (settled) return;
      settled = true;
      rejectResult(error);
    },
    restore() {
      environment.clearTimeout(timeout);
      if (environment.fetch === fetchWrapper) environment.fetch = originalFetch;
      if (prototype !== undefined && prototype.open === openWrapper) prototype.open = originalOpen;
      if (prototype !== undefined && prototype.send === sendWrapper) prototype.send = originalSend;
    },
  };
}
