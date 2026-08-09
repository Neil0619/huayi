export interface YouTubePlayer {
  getPlayerResponse(): unknown;
  getOption(module: string, option: string): unknown;
  getOptions?(): unknown;
  isSubtitlesOn?(): boolean;
  unloadModule(module: string): void;
  loadModule(module: string): void;
  setOption(module: string, option: string, value: unknown): void;
}

export interface ActiveTrack {
  languageCode: string;
  kind?: string;
  [key: string]: unknown;
}

export interface PlayerSnapshot {
  moduleLoaded: boolean;
  track: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneTrackValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const translationLanguage = value.translationLanguage;
  return {
    ...value,
    ...(isRecord(translationLanguage) ? { translationLanguage: { ...translationLanguage } } : {}),
  };
}

export function readVideoId(response: unknown): string | null {
  if (!isRecord(response) || !isRecord(response.videoDetails)) return null;
  const { videoId, isLiveContent } = response.videoDetails;
  return typeof videoId === "string" && videoId.length > 0 && isLiveContent !== true
    ? videoId
    : null;
}

export function resolveActiveTrack(
  response: unknown,
  activeTrack: ActiveTrack,
): ActiveTrack | null {
  if (!isRecord(response) || !isRecord(response.captions)) return null;
  const renderer = response.captions.playerCaptionsTracklistRenderer;
  if (!isRecord(renderer) || !Array.isArray(renderer.captionTracks)) return null;
  const candidates = renderer.captionTracks.filter((value) => {
    if (
      !isRecord(value) ||
      value.languageCode !== activeTrack.languageCode ||
      (activeTrack.kind !== undefined && value.kind !== activeTrack.kind)
    ) {
      return false;
    }
    return typeof activeTrack.vssId !== "string" || value.vssId === activeTrack.vssId;
  });
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  if (
    !isRecord(candidate) ||
    (candidate.kind !== undefined &&
      (typeof candidate.kind !== "string" || candidate.kind.length > 32))
  ) {
    return null;
  }
  return {
    ...activeTrack,
    ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
  };
}

export function readTrackValue(player: YouTubePlayer): ActiveTrack | null {
  const value = player.getOption("captions", "track");
  if (
    !isRecord(value) ||
    typeof value.languageCode !== "string" ||
    value.languageCode.length > 32 ||
    (value.kind !== undefined && (typeof value.kind !== "string" || value.kind.length > 32)) ||
    (value.translationLanguage !== undefined &&
      (!isRecord(value.translationLanguage) ||
        typeof value.translationLanguage.languageCode !== "string" ||
        value.translationLanguage.languageCode.length > 32))
  ) {
    return null;
  }
  return value as ActiveTrack;
}

export function readActiveTrack(player: YouTubePlayer): ActiveTrack | null {
  const value = readTrackValue(player);
  if (
    value === null ||
    !/^en(?:-|$)/iu.test(value.languageCode) ||
    value.translationLanguage !== undefined
  ) {
    return null;
  }
  return value;
}

export function isCaptionsModuleLoaded(player: YouTubePlayer): boolean {
  const options = player.getOptions?.();
  return Array.isArray(options) && options.includes("captions");
}

export function isCaptionsEnabled(player: YouTubePlayer): boolean {
  return player.isSubtitlesOn?.() === true && isCaptionsModuleLoaded(player);
}

export function setCaptionTrack(player: YouTubePlayer, value: unknown): void {
  player.unloadModule("captions");
  player.loadModule("captions");
  player.setOption("captions", "track", value);
}

export function sameDrivenTrack(first: unknown, second: unknown): boolean {
  if (!isRecord(first) || !isRecord(second)) return false;
  const firstTranslation = isRecord(first.translationLanguage)
    ? first.translationLanguage.languageCode
    : undefined;
  const secondTranslation = isRecord(second.translationLanguage)
    ? second.translationLanguage.languageCode
    : undefined;
  return (
    first.languageCode === second.languageCode &&
    first.kind === second.kind &&
    first.vssId === second.vssId &&
    firstTranslation === secondTranslation
  );
}

export function restorePlayer(
  player: YouTubePlayer,
  snapshot: PlayerSnapshot,
  drivenTrack: unknown,
): void {
  try {
    if (
      drivenTrack !== null &&
      (player.isSubtitlesOn?.() !== true ||
        !sameDrivenTrack(player.getOption("captions", "track"), drivenTrack))
    ) {
      return;
    }
    if (!snapshot.moduleLoaded) {
      player.unloadModule("captions");
      return;
    }
    setCaptionTrack(player, snapshot.track);
  } catch {
    // A replaced or destroyed player cannot be safely restored further.
  }
}
