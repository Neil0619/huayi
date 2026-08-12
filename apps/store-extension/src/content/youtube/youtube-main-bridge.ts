import {
  YOUTUBE_BRIDGE_RESPONSE,
  parseBridgeRequest,
  parseBridgeSetup,
  type YouTubeBridgeRequest,
  type YouTubeTrackMetadata,
} from "./youtube-bridge-contract.js";
import { installTimedTextCapture, type MainCaptureEnvironment } from "./youtube-main-capture.js";

export interface YouTubeMainPlayer {
  getOption(module: string, option: string): unknown;
  getOptions?(): unknown;
  getPlayerResponse(): unknown;
  isSubtitlesOn?(): boolean;
  loadModule(module: string): void;
  setOption(module: string, option: string, value: unknown): void;
  unloadModule(module: string): void;
}

type MainEventListener = (event: Event) => void;

export interface YouTubeMainBridgeEnvironment extends MainCaptureEnvironment {
  addEventListener(type: string, listener: MainEventListener): void;
  readonly location: Pick<Location, "hostname" | "origin" | "pathname" | "protocol">;
  postMessage(message: unknown, targetOrigin: string): void;
  removeEventListener(type: string, listener: MainEventListener): void;
}

interface MainBridgeOptions {
  readonly timeoutMs?: number;
}

interface TrackIdentity extends YouTubeTrackMetadata {
  readonly vssId?: string;
}

interface SourceCapture {
  readonly generation: number;
  readonly session: string;
  readonly track: TrackIdentity;
  readonly videoId: string;
}

const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_SESSIONS = 8;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVideoId(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.videoDetails)) return null;
  const details = value.videoDetails;
  return typeof details.videoId === "string" &&
    details.videoId.length > 0 &&
    details.videoId.length <= 128 &&
    details.isLiveContent !== true
    ? details.videoId
    : null;
}

function readTrackIdentity(value: unknown): TrackIdentity | null {
  if (!isRecord(value)) return null;
  const legacyVssId = value.vss_id;
  const vssId = value.vssId ?? legacyVssId;
  if (
    typeof value.languageCode !== "string" ||
    value.languageCode.length === 0 ||
    value.languageCode.length > 32 ||
    (value.kind !== undefined && (typeof value.kind !== "string" || value.kind.length > 32)) ||
    (vssId !== undefined && (typeof vssId !== "string" || vssId.length === 0 || vssId.length > 128))
  ) {
    return null;
  }
  return {
    ...(value.kind === undefined || value.kind === "" ? {} : { kind: value.kind }),
    languageCode: value.languageCode,
    ...(vssId === undefined ? {} : { vssId }),
  };
}

function sameTrack(first: unknown, second: unknown): boolean {
  const left = readTrackIdentity(first);
  const right = readTrackIdentity(second);
  if (left === null || right === null) return false;
  const leftTranslation =
    isRecord(first) && isRecord(first.translationLanguage)
      ? first.translationLanguage.languageCode
      : undefined;
  const rightTranslation =
    isRecord(second) && isRecord(second.translationLanguage)
      ? second.translationLanguage.languageCode
      : undefined;
  return (
    left.languageCode === right.languageCode &&
    left.kind === right.kind &&
    left.vssId === right.vssId &&
    leftTranslation === rightTranslation
  );
}

function activeEnglishTrack(player: YouTubeMainPlayer, response: unknown): TrackIdentity | null {
  if (player.isSubtitlesOn?.() !== true || !Array.isArray(player.getOptions?.())) return null;
  if (!(player.getOptions?.() as unknown[]).includes("captions")) return null;
  const active = readTrackIdentity(player.getOption("captions", "track"));
  if (active === null || !/^en(?:-|$)/iu.test(active.languageCode)) return null;
  if (!isRecord(response) || !isRecord(response.captions)) return null;
  const renderer = response.captions.playerCaptionsTracklistRenderer;
  if (!isRecord(renderer) || !Array.isArray(renderer.captionTracks)) return null;
  const matches = renderer.captionTracks
    .map(readTrackIdentity)
    .filter(
      (candidate): candidate is TrackIdentity =>
        candidate !== null &&
        candidate.languageCode === active.languageCode &&
        (active.kind === undefined || candidate.kind === active.kind) &&
        (active.vssId === undefined || candidate.vssId === active.vssId),
    );
  if (matches.length !== 1) return null;
  return { ...active, ...(matches[0]?.kind === undefined ? {} : { kind: matches[0].kind }) };
}

function cloneTrack(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    ...(isRecord(value.translationLanguage)
      ? { translationLanguage: { ...value.translationLanguage } }
      : {}),
  };
}

function driveTrack(player: YouTubeMainPlayer, value: unknown): void {
  player.unloadModule("captions");
  player.loadModule("captions");
  player.setOption("captions", "track", value);
}

function sessionKey(channel: string, capability: string): string {
  return `${channel}\u0000${capability}`;
}

export function createYouTubeMainBridge(
  environment: YouTubeMainBridgeEnvironment,
  getPlayer: () => YouTubeMainPlayer | null,
  options: MainBridgeOptions = {},
) {
  const sessions: string[] = [];
  const highestGeneration = new Map<string, number>();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cancelCurrent: (() => void) | null = null;
  let destroyed = false;
  let sourceCapture: SourceCapture | null = null;
  let queue = Promise.resolve();

  const postFailure = (request: YouTubeBridgeRequest, error: string): void => {
    environment.postMessage(
      { ...request, error, ok: false, type: YOUTUBE_BRIDGE_RESPONSE },
      environment.location.origin,
    );
  };

  const execute = async (request: YouTubeBridgeRequest): Promise<void> => {
    const session = sessionKey(request.channel, request.capability);
    const highest = highestGeneration.get(session) ?? -1;
    if (destroyed || request.generation < highest) {
      postFailure(request, "stale");
      return;
    }
    highestGeneration.set(session, request.generation);
    if (
      environment.location.protocol !== "https:" ||
      !YOUTUBE_HOSTS.has(environment.location.hostname.toLowerCase()) ||
      environment.location.pathname !== "/watch"
    ) {
      postFailure(request, "unavailable");
      return;
    }
    const player = getPlayer();
    const response = player?.getPlayerResponse();
    const videoId = readVideoId(response);
    const originalTrack = player === null ? null : player.getOption("captions", "track");
    const track = player === null ? null : activeEnglishTrack(player, response);
    if (player === null || videoId !== request.expectedVideoId || track === null) {
      postFailure(request, "unavailable");
      return;
    }
    if (
      request.target === "translated" &&
      (sourceCapture === null ||
        sourceCapture.session !== session ||
        sourceCapture.generation !== request.generation ||
        sourceCapture.videoId !== videoId ||
        !sameTrack(sourceCapture.track, originalTrack))
    ) {
      postFailure(request, "unavailable");
      return;
    }
    const snapshot = cloneTrack(originalTrack);
    const driven =
      request.target === "source"
        ? cloneTrack(originalTrack)
        : {
            ...(isRecord(originalTrack) ? originalTrack : {}),
            translationLanguage: { languageCode: "zh-Hans" },
          };
    const capture = installTimedTextCapture(environment, request, track, timeoutMs);
    cancelCurrent = () => capture.cancel("stale");
    try {
      driveTrack(player, driven);
      const captured = await capture.result;
      if (
        destroyed ||
        request.generation < (highestGeneration.get(session) ?? -1) ||
        readVideoId(player.getPlayerResponse()) !== request.expectedVideoId ||
        !sameTrack(player.getOption("captions", "track"), driven)
      ) {
        postFailure(request, "stale");
        return;
      }
      if (request.target === "source") {
        sourceCapture = { generation: request.generation, session, track, videoId };
      }
      environment.postMessage(
        {
          ...request,
          body: captured.body,
          fingerprint: captured.fingerprint,
          ok: true,
          track: {
            ...(track.kind === undefined ? {} : { kind: track.kind }),
            languageCode: track.languageCode,
          },
          type: YOUTUBE_BRIDGE_RESPONSE,
        },
        environment.location.origin,
      );
    } catch (error) {
      postFailure(
        request,
        error === "timeout" || error === "invalid-response" || error === "stale"
          ? error
          : "unavailable",
      );
    } finally {
      cancelCurrent = null;
      capture.restore();
      if (sameTrack(player.getOption("captions", "track"), driven)) {
        try {
          driveTrack(player, snapshot);
        } catch {
          // A replaced player cannot be restored further.
        }
      }
    }
  };

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== (environment as unknown) || event.origin !== environment.location.origin) {
      return;
    }
    const setup = parseBridgeSetup(event.data);
    if (setup !== null) {
      const key = sessionKey(setup.channel, setup.capability);
      const existing = sessions.indexOf(key);
      if (existing >= 0) sessions.splice(existing, 1);
      sessions.push(key);
      while (sessions.length > MAX_SESSIONS) {
        const removed = sessions.shift();
        if (removed !== undefined) highestGeneration.delete(removed);
      }
      return;
    }
    const request = parseBridgeRequest(event.data);
    if (request === null || !sessions.includes(sessionKey(request.channel, request.capability))) {
      return;
    }
    queue = queue.then(
      () => execute(request),
      () => execute(request),
    );
    queue = queue.catch(() => {
      try {
        postFailure(request, "unavailable");
      } catch {
        // A destroyed page has no remaining consumer for the failure.
      }
    });
  };
  const handleNavigation = (): void => {
    sourceCapture = null;
    cancelCurrent?.();
  };
  environment.addEventListener("message", handleMessage as MainEventListener);
  environment.addEventListener("yt-navigate-start", handleNavigation);
  environment.addEventListener("pagehide", handleNavigation);
  return {
    destroy() {
      destroyed = true;
      sourceCapture = null;
      cancelCurrent?.();
      environment.removeEventListener("message", handleMessage as MainEventListener);
      environment.removeEventListener("yt-navigate-start", handleNavigation);
      environment.removeEventListener("pagehide", handleNavigation);
    },
  };
}
