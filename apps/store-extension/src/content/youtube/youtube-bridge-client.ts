import {
  YOUTUBE_BRIDGE_REQUEST,
  YOUTUBE_BRIDGE_SETUP,
  parseBridgeResponse,
  parseTimedTextBody,
  type TimedTextCue,
  type YouTubeBridgeCorrelation,
  type YouTubeCaptionTarget,
  type YouTubeTrackMetadata,
} from "./youtube-bridge-contract.js";

export interface CapturedCaptionTrack {
  readonly cues: readonly TimedTextCue[];
  readonly track: YouTubeTrackMetadata;
}

export interface CaptionCaptureRequest {
  readonly expectedVideoId: string;
  readonly generation: number;
  readonly target: YouTubeCaptionTarget;
}

export interface CaptionBridge {
  capture(request: CaptionCaptureRequest): Promise<CapturedCaptionTrack | null>;
  destroy(): void;
}

interface PendingCapture {
  readonly correlation: YouTubeBridgeCorrelation;
  readonly resolve: (result: CapturedCaptionTrack | null) => void;
  readonly timeout: number;
}

interface YouTubeBridgeClientOptions {
  readonly capability: string;
  readonly channel: string;
  readonly createRequestId?: () => string;
  readonly document?: Document;
  readonly getCurrentVideoId: () => string | null;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 7_000;

export class YouTubeBridgeClient implements CaptionBridge {
  private readonly capability: string;
  private readonly channel: string;
  private readonly createRequestId: () => string;
  private readonly documentRef: Document;
  private readonly getCurrentVideoId: () => string | null;
  private readonly pending = new Map<string, PendingCapture>();
  private readonly timeoutMs: number;
  private readonly windowRef: Window & typeof globalThis;
  private destroyed = false;

  constructor(options: YouTubeBridgeClientOptions) {
    this.capability = options.capability;
    this.channel = options.channel;
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
    this.documentRef = options.document ?? document;
    const windowRef = this.documentRef.defaultView;
    if (windowRef === null) throw new Error("YouTube bridge requires a window.");
    this.windowRef = windowRef;
    this.getCurrentVideoId = options.getCurrentVideoId;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.windowRef.addEventListener("message", this.handleMessage);
    this.windowRef.postMessage(
      {
        capability: this.capability,
        channel: this.channel,
        type: YOUTUBE_BRIDGE_SETUP,
      },
      this.documentRef.location.origin,
    );
  }

  capture(request: CaptionCaptureRequest): Promise<CapturedCaptionTrack | null> {
    if (
      this.destroyed ||
      this.getCurrentVideoId() !== request.expectedVideoId ||
      !Number.isSafeInteger(request.generation) ||
      request.generation < 0
    ) {
      return Promise.resolve(null);
    }
    const correlation: YouTubeBridgeCorrelation = {
      capability: this.capability,
      channel: this.channel,
      expectedVideoId: request.expectedVideoId,
      generation: request.generation,
      requestId: this.createRequestId(),
      target: request.target,
    };
    if (this.pending.has(correlation.requestId)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const pending: PendingCapture = {
        correlation,
        resolve,
        timeout: this.windowRef.setTimeout(
          () => this.finish(correlation.requestId, null),
          this.timeoutMs,
        ),
      };
      this.pending.set(correlation.requestId, pending);
      this.windowRef.postMessage(
        { ...correlation, type: YOUTUBE_BRIDGE_REQUEST },
        this.documentRef.location.origin,
      );
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.windowRef.removeEventListener("message", this.handleMessage);
    for (const requestId of [...this.pending.keys()]) this.finish(requestId, null);
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.windowRef || event.origin !== this.documentRef.location.origin)
      return;
    if (typeof event.data !== "object" || event.data === null || !("requestId" in event.data)) {
      return;
    }
    const requestId = (event.data as { requestId?: unknown }).requestId;
    if (typeof requestId !== "string") return;
    const pending = this.pending.get(requestId);
    if (pending === undefined || this.getCurrentVideoId() !== pending.correlation.expectedVideoId) {
      return;
    }
    const response = parseBridgeResponse(event.data, pending.correlation);
    if (response === null) return;
    if (!response.ok) {
      this.finish(requestId, null);
      return;
    }
    const cues = parseTimedTextBody(response.body);
    this.finish(requestId, cues === null ? null : { cues, track: response.track });
  };

  private finish(requestId: string, result: CapturedCaptionTrack | null): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.pending.delete(requestId);
    this.windowRef.clearTimeout(pending.timeout);
    pending.resolve(result);
  }
}
