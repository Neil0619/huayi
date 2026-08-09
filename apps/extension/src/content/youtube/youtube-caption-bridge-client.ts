import {
  parseBridgeResponse,
  parseBridgeRequest,
  parseSourceProbeRequest,
  parseSourceProbeResponse,
  parseTimedTextBody,
  YOUTUBE_BRIDGE_REQUEST,
  YOUTUBE_SOURCE_PROBE_REQUEST,
  type TimedTextCue,
  type YouTubeCaptionTarget,
  type YouTubeSourceStatus,
  type YouTubeTrackMetadata,
} from "./youtube-bridge-contract.js";

export interface CapturedCaptionTrack {
  cues: TimedTextCue[];
  track: YouTubeTrackMetadata;
}

export interface CaptionCaptureRequest {
  expectedVideoId: string;
  generation: number;
  target: YouTubeCaptionTarget;
}

export interface SourceIdentityRequest {
  expectedVideoId: string;
  generation: number;
}

export interface YouTubeCaptionBridge {
  capture(request: CaptionCaptureRequest): Promise<CapturedCaptionTrack | null>;
  destroy(): void;
  probeSource(request: SourceIdentityRequest): Promise<YouTubeSourceStatus>;
}

interface PendingCapture extends CaptionCaptureRequest {
  requestId: string;
  resolve(result: CapturedCaptionTrack | null): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingSourceProbe extends SourceIdentityRequest {
  requestId: string;
  resolve(status: YouTubeSourceStatus): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface SourceIdentity {
  generation: number;
  kind?: string;
  languageCode: string;
  videoId: string;
}

interface YouTubeCaptionBridgeClientOptions {
  createRequestId?: () => string;
  document?: Document;
  getCurrentVideoId?: () => string | null;
  timeoutMs?: number;
  validatePlayerState: (
    track: YouTubeTrackMetadata,
    target: YouTubeCaptionTarget,
  ) => boolean | "retry";
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const DEFAULT_TIMEOUT_MS = 7_000;
const PLAYER_STATE_RETRY_MS = 50;
const SOURCE_PROBE_TIMEOUT_MS = 1_000;
const TRANSLATED_RESTORATION_STABILITY_MS = 750;

export function videoIdFromUrl(value: string): string | null {
  let location: URL;
  try {
    location = new URL(value);
  } catch {
    return null;
  }
  if (
    location.protocol !== "https:" ||
    !YOUTUBE_HOSTS.has(location.hostname.toLowerCase()) ||
    location.pathname !== "/watch"
  ) {
    return null;
  }
  const videoId = location.searchParams.get("v");
  return videoId !== null && videoId.length > 0 ? videoId : null;
}

function sameTrack(first: SourceIdentity, second: YouTubeTrackMetadata): boolean {
  return first.languageCode === second.languageCode && first.kind === second.kind;
}

export class YouTubeCaptionBridgeClient implements YouTubeCaptionBridge {
  private readonly createRequestId: () => string;
  private readonly documentRef: Document;
  private readonly getCurrentVideoId: () => string | null;
  private readonly pending = new Map<string, PendingCapture>();
  private readonly pendingSourceProbes = new Map<string, PendingSourceProbe>();
  private readonly timeoutMs: number;
  private readonly validatePlayerState: YouTubeCaptionBridgeClientOptions["validatePlayerState"];
  private readonly windowRef: Window & typeof globalThis;
  private destroyed = false;
  private sourceIdentity: SourceIdentity | null = null;

  constructor(options: YouTubeCaptionBridgeClientOptions) {
    this.documentRef = options.document ?? document;
    const windowRef = this.documentRef.defaultView;
    if (windowRef === null) throw new Error("YouTube bridge requires a window.");
    this.windowRef = windowRef;
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
    this.getCurrentVideoId =
      options.getCurrentVideoId ?? (() => videoIdFromUrl(this.documentRef.location.href));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.validatePlayerState = options.validatePlayerState;
    this.windowRef.addEventListener("message", this.handleMessage);
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
    const requestId = this.createRequestId();
    const outbound = parseBridgeRequest({ ...request, requestId, type: YOUTUBE_BRIDGE_REQUEST });
    if (
      outbound === null ||
      this.pending.has(requestId) ||
      this.pendingSourceProbes.has(requestId)
    ) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const pending: PendingCapture = {
        ...request,
        requestId,
        resolve,
        timeout: setTimeout(() => this.finish(requestId, null), this.timeoutMs),
      };
      this.pending.set(requestId, pending);
      this.windowRef.postMessage(outbound, this.documentRef.location.origin);
    });
  }

  probeSource(request: SourceIdentityRequest): Promise<YouTubeSourceStatus> {
    const source = this.sourceIdentity;
    if (
      this.destroyed ||
      this.getCurrentVideoId() !== request.expectedVideoId ||
      !Number.isSafeInteger(request.generation) ||
      request.generation < 0 ||
      source === null ||
      source.generation !== request.generation ||
      source.videoId !== request.expectedVideoId
    ) {
      return Promise.resolve("unavailable");
    }
    const requestId = this.createRequestId();
    const outbound = parseSourceProbeRequest({
      type: YOUTUBE_SOURCE_PROBE_REQUEST,
      requestId,
      generation: request.generation,
      expectedVideoId: request.expectedVideoId,
    });
    if (
      outbound === null ||
      this.pending.has(requestId) ||
      this.pendingSourceProbes.has(requestId)
    ) {
      return Promise.resolve("unavailable");
    }
    return new Promise((resolve) => {
      const pending: PendingSourceProbe = {
        ...request,
        requestId,
        resolve,
        timeout: setTimeout(
          () => this.finishSourceProbe(requestId, "unavailable"),
          Math.min(this.timeoutMs, SOURCE_PROBE_TIMEOUT_MS),
        ),
      };
      this.pendingSourceProbes.set(requestId, pending);
      this.windowRef.postMessage(outbound, this.documentRef.location.origin);
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.windowRef.removeEventListener("message", this.handleMessage);
    for (const requestId of [...this.pending.keys()]) this.finish(requestId, null);
    for (const requestId of [...this.pendingSourceProbes.keys()]) {
      this.finishSourceProbe(requestId, "unavailable");
    }
    this.sourceIdentity = null;
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.windowRef || event.origin !== this.documentRef.location.origin)
      return;
    const response = parseBridgeResponse(event.data);
    if (response === null) {
      const sourceProbe = parseSourceProbeResponse(event.data);
      if (sourceProbe === null) return;
      const pendingSourceProbe = this.pendingSourceProbes.get(sourceProbe.requestId);
      if (
        pendingSourceProbe === undefined ||
        sourceProbe.generation !== pendingSourceProbe.generation ||
        sourceProbe.expectedVideoId !== pendingSourceProbe.expectedVideoId ||
        this.getCurrentVideoId() !== pendingSourceProbe.expectedVideoId
      ) {
        return;
      }
      this.finishSourceProbe(sourceProbe.requestId, sourceProbe.status);
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (
      pending === undefined ||
      response.generation !== pending.generation ||
      response.expectedVideoId !== pending.expectedVideoId ||
      response.target !== pending.target
    ) {
      return;
    }
    if (!response.ok) {
      if (
        pending.target === "translated" &&
        (response.error === "timeout" || response.error === "invalid-response")
      ) {
        this.finishTranslatedFailureWhenPlayerStable(pending);
        return;
      }
      this.finish(pending.requestId, null);
      return;
    }
    const cues = parseTimedTextBody(response.body);
    if (cues === null) {
      this.finish(pending.requestId, null);
      return;
    }
    this.finishWhenPlayerStable(pending, response.track, cues);
  };

  private finishWhenPlayerStable(
    pending: PendingCapture,
    track: YouTubeTrackMetadata,
    cues: TimedTextCue[],
    stableChecks = 0,
  ): void {
    if (this.pending.get(pending.requestId) !== pending) return;
    const source = this.sourceIdentity;
    const validTranslatedSource =
      pending.target === "source" ||
      (source !== null &&
        source.generation === pending.generation &&
        source.videoId === pending.expectedVideoId &&
        sameTrack(source, track));
    if (this.getCurrentVideoId() !== pending.expectedVideoId || !validTranslatedSource) {
      this.finish(pending.requestId, null);
      return;
    }
    const playerState = this.validatePlayerState(track, pending.target);
    if (playerState === "retry") {
      this.windowRef.setTimeout(
        () => this.finishWhenPlayerStable(pending, track, cues, 0),
        PLAYER_STATE_RETRY_MS,
      );
      return;
    }
    if (!playerState) {
      this.finish(pending.requestId, null);
      return;
    }
    if (
      pending.target === "translated" &&
      stableChecks * PLAYER_STATE_RETRY_MS < TRANSLATED_RESTORATION_STABILITY_MS
    ) {
      this.windowRef.setTimeout(
        () => this.finishWhenPlayerStable(pending, track, cues, stableChecks + 1),
        PLAYER_STATE_RETRY_MS,
      );
      return;
    }
    if (pending.target === "source") {
      this.sourceIdentity = {
        generation: pending.generation,
        ...(track.kind === undefined ? {} : { kind: track.kind }),
        languageCode: track.languageCode,
        videoId: pending.expectedVideoId,
      };
    }
    this.finish(pending.requestId, { cues, track });
  }

  private finishTranslatedFailureWhenPlayerStable(pending: PendingCapture, stableChecks = 0): void {
    if (this.pending.get(pending.requestId) !== pending) return;
    const source = this.sourceIdentity;
    if (
      this.getCurrentVideoId() !== pending.expectedVideoId ||
      source === null ||
      source.generation !== pending.generation ||
      source.videoId !== pending.expectedVideoId
    ) {
      this.finish(pending.requestId, null);
      return;
    }
    const playerState = this.validatePlayerState(
      {
        ...(source.kind === undefined ? {} : { kind: source.kind }),
        languageCode: source.languageCode,
      },
      "translated",
    );
    if (playerState === "retry") {
      this.windowRef.setTimeout(
        () => this.finishTranslatedFailureWhenPlayerStable(pending, 0),
        PLAYER_STATE_RETRY_MS,
      );
      return;
    }
    if (playerState && stableChecks * PLAYER_STATE_RETRY_MS < TRANSLATED_RESTORATION_STABILITY_MS) {
      this.windowRef.setTimeout(
        () => this.finishTranslatedFailureWhenPlayerStable(pending, stableChecks + 1),
        PLAYER_STATE_RETRY_MS,
      );
      return;
    }
    this.finish(pending.requestId, null);
  }

  private finish(requestId: string, result: CapturedCaptionTrack | null): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(result);
  }

  private finishSourceProbe(requestId: string, status: YouTubeSourceStatus): void {
    const pending = this.pendingSourceProbes.get(requestId);
    if (pending === undefined) return;
    this.pendingSourceProbes.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(status);
  }
}
