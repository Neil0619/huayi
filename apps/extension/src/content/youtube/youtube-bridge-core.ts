import {
  parseBridgeRequest,
  parseSourceProbeRequest,
  YOUTUBE_BRIDGE_RESPONSE,
  YOUTUBE_SOURCE_PROBE_RESPONSE,
  type YouTubeBridgeError,
  type YouTubeBridgeRequest,
  type YouTubeSourceProbeRequest,
  type YouTubeSourceStatus,
  type YouTubeTrackMetadata,
} from "./youtube-bridge-contract.js";
import { installTimedTextCapture, type CapturedTimedText } from "./youtube-bridge-capture.js";
import {
  cloneTrackValue,
  isCaptionsEnabled,
  isCaptionsModuleLoaded,
  readActiveTrack,
  readTrackValue,
  readVideoId,
  resolveActiveTrack,
  restorePlayer,
  sameDrivenTrack,
  setCaptionTrack,
  type ActiveTrack,
  type YouTubePlayer,
} from "./youtube-bridge-player.js";

export type { YouTubePlayer } from "./youtube-bridge-player.js";

type EventListenerLike = (event: Event) => void;
type TimerHandle = ReturnType<typeof setTimeout>;

export interface YouTubeBridgeEnvironment {
  addEventListener(type: string, listener: EventListenerLike): void;
  removeEventListener(type: string, listener: EventListenerLike): void;
  postMessage(message: unknown, targetOrigin?: string): void;
  fetch: typeof fetch;
  XMLHttpRequest: typeof XMLHttpRequest;
  setTimeout(handler: () => void, timeout: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  location?: Pick<Location, "hostname" | "pathname">;
}

interface CapturedSource {
  generation: number;
  track: unknown;
  videoId: string;
}

interface BridgeOptions {
  timeoutMs?: number;
}
const DEFAULT_TIMEOUT_MS = 3_000;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

async function captureTrack(
  environment: YouTubeBridgeEnvironment,
  player: YouTubePlayer,
  request: YouTubeBridgeRequest,
  activeTrack: ActiveTrack,
  timeoutMs: number,
  setCancel: (cancel: (() => void) | null) => void,
  setDrivenTrack: (track: unknown) => void,
): Promise<CapturedTimedText> {
  const capture = installTimedTextCapture(environment, request, activeTrack, timeoutMs);
  setCancel(() => capture.cancel("stale"));
  try {
    const option =
      request.target === "source"
        ? activeTrack
        : { ...activeTrack, translationLanguage: { languageCode: "zh-Hans" } };
    setCaptionTrack(player, option);
    setDrivenTrack(option);
    const captured = await capture.result;
    if (
      !isCaptionsEnabled(player) ||
      !sameDrivenTrack(player.getOption("captions", "track"), option)
    ) {
      throw new Error("Caption player state changed.");
    }
    return captured;
  } finally {
    setCancel(null);
    capture.restore();
  }
}

function postFailure(
  environment: YouTubeBridgeEnvironment,
  request: YouTubeBridgeRequest,
  error: YouTubeBridgeError,
): void {
  environment.postMessage(
    {
      type: YOUTUBE_BRIDGE_RESPONSE,
      requestId: request.requestId,
      generation: request.generation,
      expectedVideoId: request.expectedVideoId,
      target: request.target,
      ok: false,
      error,
    },
    "*",
  );
}

export function createYouTubeBridge(
  environment: YouTubeBridgeEnvironment,
  getPlayer: () => YouTubePlayer | null,
  options: BridgeOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let destroyed = false;
  let highestGeneration = -1;
  let queue = Promise.resolve();
  let cancelCurrent: (() => void) | null = null;
  let capturedSource: CapturedSource | null = null;
  const setCancel = (cancel: (() => void) | null): void => {
    cancelCurrent = cancel;
  };

  const execute = async (request: YouTubeBridgeRequest): Promise<void> => {
    if (destroyed || request.generation < highestGeneration) {
      postFailure(environment, request, "stale");
      return;
    }
    highestGeneration = request.generation;
    if (
      environment.location !== undefined &&
      (environment.location.pathname !== "/watch" ||
        !YOUTUBE_HOSTS.has(environment.location.hostname))
    ) {
      postFailure(environment, request, "unavailable");
      return;
    }
    const player = getPlayer();
    if (player === null || !isCaptionsEnabled(player)) {
      postFailure(environment, request, "unavailable");
      return;
    }
    const playerResponse = player.getPlayerResponse();
    const videoId = readVideoId(playerResponse);
    const activeTrackValue = readActiveTrack(player);
    const activeTrack =
      activeTrackValue === null ? null : resolveActiveTrack(playerResponse, activeTrackValue);
    if (videoId !== request.expectedVideoId || activeTrack === null) {
      postFailure(environment, request, "unavailable");
      return;
    }
    if (
      request.target === "translated" &&
      (capturedSource === null ||
        capturedSource.generation !== request.generation ||
        capturedSource.videoId !== request.expectedVideoId ||
        !sameDrivenTrack(capturedSource.track, activeTrackValue))
    ) {
      postFailure(environment, request, "unavailable");
      return;
    }
    const snapshot = {
      moduleLoaded: isCaptionsModuleLoaded(player),
      track: cloneTrackValue(activeTrackValue),
    };
    let drivenTrack: unknown = null;
    let failure: YouTubeBridgeError | null = null;
    let response: unknown = null;
    try {
      const captured = await captureTrack(
        environment,
        player,
        request,
        activeTrack,
        timeoutMs,
        setCancel,
        (track) => {
          drivenTrack = track;
        },
      );
      if (
        destroyed ||
        request.generation < highestGeneration ||
        readVideoId(player.getPlayerResponse()) !== request.expectedVideoId
      ) {
        failure = "stale";
      } else {
        const track: YouTubeTrackMetadata = {
          languageCode: activeTrack.languageCode,
          ...(activeTrack.kind === undefined ? {} : { kind: activeTrack.kind }),
        };
        if (request.target === "source") {
          capturedSource = {
            generation: request.generation,
            track: cloneTrackValue(activeTrackValue),
            videoId: request.expectedVideoId,
          };
        }
        response = {
          type: YOUTUBE_BRIDGE_RESPONSE,
          requestId: request.requestId,
          generation: request.generation,
          expectedVideoId: request.expectedVideoId,
          target: request.target,
          ok: true,
          videoId,
          track,
          fingerprint: captured.fingerprint,
          body: captured.body,
        };
      }
    } catch (error) {
      failure =
        error === "timeout" || error === "invalid-response" || error === "stale"
          ? error
          : "unavailable";
    } finally {
      restorePlayer(player, snapshot, drivenTrack);
    }
    if (response !== null) environment.postMessage(response, "*");
    else postFailure(environment, request, failure ?? "unavailable");
  };

  const executeSourceProbe = (request: YouTubeSourceProbeRequest): void => {
    let status: YouTubeSourceStatus = "unavailable";
    if (
      !destroyed &&
      request.generation >= highestGeneration &&
      capturedSource !== null &&
      capturedSource.generation === request.generation &&
      capturedSource.videoId === request.expectedVideoId &&
      (environment.location === undefined ||
        (environment.location.pathname === "/watch" &&
          YOUTUBE_HOSTS.has(environment.location.hostname)))
    ) {
      const player = getPlayer();
      if (player !== null && isCaptionsEnabled(player)) {
        const videoId = readVideoId(player.getPlayerResponse());
        const activeTrack = readTrackValue(player);
        if (videoId === request.expectedVideoId && activeTrack !== null) {
          if (
            !/^en(?:-|$)/iu.test(activeTrack.languageCode) ||
            activeTrack.translationLanguage !== undefined
          ) {
            status = "non-english";
          } else {
            status = sameDrivenTrack(capturedSource.track, activeTrack)
              ? "same-source"
              : "different-english";
          }
        }
      }
    }
    environment.postMessage(
      {
        type: YOUTUBE_SOURCE_PROBE_RESPONSE,
        requestId: request.requestId,
        generation: request.generation,
        expectedVideoId: request.expectedVideoId,
        status,
      },
      "*",
    );
  };

  const handleMessage = (event: MessageEvent): void => {
    if ((event.source as unknown) !== environment) return;
    const sourceProbe = parseSourceProbeRequest(event.data);
    if (sourceProbe !== null) {
      queue = queue.then(
        () => executeSourceProbe(sourceProbe),
        () => executeSourceProbe(sourceProbe),
      );
      return;
    }
    const request = parseBridgeRequest(event.data);
    if (request === null) return;
    if (request.generation < highestGeneration) {
      postFailure(environment, request, "stale");
      return;
    }
    highestGeneration = Math.max(highestGeneration, request.generation);
    queue = queue.then(
      () => execute(request),
      () => execute(request),
    );
    queue = queue.catch(() => postFailure(environment, request, "unavailable"));
  };
  const handleNavigation = (): void => {
    highestGeneration += 1;
    capturedSource = null;
    cancelCurrent?.();
  };
  environment.addEventListener("message", handleMessage as EventListenerLike);
  environment.addEventListener("yt-navigate-start", handleNavigation);
  environment.addEventListener("pagehide", handleNavigation);

  return {
    handleMessage,
    destroy() {
      destroyed = true;
      capturedSource = null;
      cancelCurrent?.();
      environment.removeEventListener("message", handleMessage as EventListenerLike);
      environment.removeEventListener("yt-navigate-start", handleNavigation);
      environment.removeEventListener("pagehide", handleNavigation);
    },
  };
}
