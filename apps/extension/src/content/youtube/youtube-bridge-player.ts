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

interface TrackIdentity {
  kind?: string;
  languageCode: string;
  vssId?: string;
}

const MAX_LANGUAGE_CODE_LENGTH = 32;
const MAX_KIND_LENGTH = 32;
const MAX_VSS_ID_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrackIdentity(value: unknown): TrackIdentity | null {
  if (!isRecord(value)) return null;
  const { kind, languageCode, vssId, vss_id: legacyVssId } = value;
  if (
    typeof languageCode !== "string" ||
    languageCode.length === 0 ||
    languageCode.length > MAX_LANGUAGE_CODE_LENGTH ||
    (kind !== undefined && (typeof kind !== "string" || kind.length > MAX_KIND_LENGTH)) ||
    (vssId !== undefined &&
      (typeof vssId !== "string" || vssId.length === 0 || vssId.length > MAX_VSS_ID_LENGTH)) ||
    (legacyVssId !== undefined &&
      (typeof legacyVssId !== "string" ||
        legacyVssId.length === 0 ||
        legacyVssId.length > MAX_VSS_ID_LENGTH)) ||
    (vssId !== undefined && legacyVssId !== undefined && vssId !== legacyVssId)
  ) {
    return null;
  }
  return {
    languageCode,
    ...(kind === undefined || kind.length === 0 ? {} : { kind }),
    ...(vssId === undefined && legacyVssId === undefined
      ? {}
      : { vssId: (vssId ?? legacyVssId) as string }),
  };
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
  const activeIdentity = readTrackIdentity(activeTrack);
  if (activeIdentity === null) return null;
  const renderer = response.captions.playerCaptionsTracklistRenderer;
  if (!isRecord(renderer) || !Array.isArray(renderer.captionTracks)) return null;
  const candidates = renderer.captionTracks.filter((value) => {
    const identity = readTrackIdentity(value);
    return (
      identity !== null &&
      identity.languageCode === activeIdentity.languageCode &&
      (activeIdentity.kind === undefined || identity.kind === activeIdentity.kind) &&
      (activeIdentity.vssId === undefined || identity.vssId === activeIdentity.vssId)
    );
  });
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  const candidateIdentity = readTrackIdentity(candidate);
  if (candidateIdentity === null) return null;
  const resolved = { ...activeTrack };
  if (candidateIdentity.kind === undefined) Reflect.deleteProperty(resolved, "kind");
  else resolved.kind = candidateIdentity.kind;
  return resolved;
}

export function readTrackValue(player: YouTubePlayer): ActiveTrack | null {
  const value = player.getOption("captions", "track");
  if (
    !isRecord(value) ||
    readTrackIdentity(value) === null ||
    (value.translationLanguage !== undefined &&
      (!isRecord(value.translationLanguage) ||
        typeof value.translationLanguage.languageCode !== "string" ||
        value.translationLanguage.languageCode.length > MAX_LANGUAGE_CODE_LENGTH))
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
  const firstIdentity = readTrackIdentity(first);
  const secondIdentity = readTrackIdentity(second);
  if (firstIdentity === null || secondIdentity === null) return false;
  const firstTranslation = isRecord(first.translationLanguage)
    ? first.translationLanguage.languageCode
    : undefined;
  const secondTranslation = isRecord(second.translationLanguage)
    ? second.translationLanguage.languageCode
    : undefined;
  return (
    firstIdentity.languageCode === secondIdentity.languageCode &&
    firstIdentity.kind === secondIdentity.kind &&
    firstIdentity.vssId === secondIdentity.vssId &&
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
