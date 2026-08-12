import {
  MAX_TIMED_TEXT_BYTES,
  parseTimedTextBody,
  type YouTubeBridgeRequest,
  type YouTubeTimedTextFingerprint,
  type YouTubeTrackMetadata,
} from "./youtube-bridge-contract.js";

type CaptureError = "invalid-response" | "stale" | "timeout";
type TimerHandle = ReturnType<typeof setTimeout>;

export interface MainCaptureEnvironment {
  XMLHttpRequest: typeof XMLHttpRequest;
  clearTimeout(handle: TimerHandle): void;
  fetch: typeof fetch;
  setTimeout(handler: () => void, timeout: number): TimerHandle;
}

export interface CapturedTimedText {
  readonly body: string;
  readonly fingerprint: YouTubeTimedTextFingerprint;
}

export interface TimedTextCapture {
  readonly result: Promise<CapturedTimedText>;
  cancel(error: CaptureError): void;
  restore(): void;
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

function expectedFingerprint(
  value: string,
  request: YouTubeBridgeRequest,
  track: YouTubeTrackMetadata,
): YouTubeTimedTextFingerprint | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    !YOUTUBE_HOSTS.has(url.hostname) ||
    url.pathname !== "/api/timedtext" ||
    url.searchParams.get("v") !== request.expectedVideoId ||
    url.searchParams.get("lang") !== track.languageCode ||
    url.searchParams.get("fmt") !== "json3" ||
    url.searchParams.get("kind") !== (track.kind ?? null) ||
    (request.target === "source"
      ? url.searchParams.has("tlang")
      : url.searchParams.get("tlang") !== "zh-Hans")
  ) {
    return null;
  }
  return {
    fmt: "json3",
    host: url.hostname as YouTubeTimedTextFingerprint["host"],
    ...(track.kind === undefined ? {} : { kind: track.kind }),
    lang: track.languageCode,
    path: "/api/timedtext",
    ...(request.target === "source" ? {} : { tlang: "zh-Hans" as const }),
    v: request.expectedVideoId,
  };
}

async function boundedResponseBody(response: Response): Promise<string | null> {
  if (!response.ok) return null;
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0 || length > MAX_TIMED_TEXT_BYTES) return null;
  }
  try {
    if (response.body === null) {
      const body = await response.text();
      return parseTimedTextBody(body) === null ? null : body;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_TIMED_TEXT_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
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
  environment: MainCaptureEnvironment,
  request: YouTubeBridgeRequest,
  track: YouTubeTrackMetadata,
  timeoutMs: number,
): TimedTextCapture {
  let settled = false;
  let resolveResult: (value: CapturedTimedText) => void = () => undefined;
  let rejectResult: (reason: CaptureError) => void = () => undefined;
  const result = new Promise<CapturedTimedText>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const settle = async (url: string, response: Response): Promise<void> => {
    if (settled) return;
    const fingerprint = expectedFingerprint(url, request, track);
    if (fingerprint === null) return;
    const body = await boundedResponseBody(response);
    if (settled) return;
    settled = true;
    if (body === null) rejectResult("invalid-response");
    else resolveResult({ body, fingerprint });
  };

  const originalFetch = environment.fetch;
  const fetchWrapper: typeof fetch = async function (input, init) {
    const response = await originalFetch.call(environment, input, init);
    if (!settled) {
      try {
        void settle(input instanceof Request ? input.url : input.toString(), response.clone());
      } catch {
        // Capture must not alter page fetch behavior.
      }
    }
    return response;
  };
  environment.fetch = fetchWrapper;

  const prototype = environment.XMLHttpRequest?.prototype;
  const originalOpen = prototype?.open;
  const originalSend = prototype?.send;
  const urls = new WeakMap<XMLHttpRequest, string>();
  let openWrapper: typeof XMLHttpRequest.prototype.open | undefined;
  let sendWrapper: typeof XMLHttpRequest.prototype.send | undefined;
  if (prototype !== undefined && originalOpen !== undefined && originalSend !== undefined) {
    openWrapper = function (this: XMLHttpRequest, method: string, url: string | URL, ...args) {
      urls.set(this, url.toString());
      return Reflect.apply(originalOpen, this, [method, url, ...args]);
    } as typeof XMLHttpRequest.prototype.open;
    sendWrapper = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      this.addEventListener(
        "loadend",
        () => {
          const url = urls.get(this);
          if (settled || url === undefined || this.status < 200 || this.status >= 300) return;
          if (this.responseType !== "" && this.responseType !== "text") return;
          try {
            void settle(url, new Response(this.responseText, { status: this.status }));
          } catch {
            // Capture must not alter page XHR behavior.
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
