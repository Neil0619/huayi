export const YOUTUBE_BRIDGE_REQUEST = "huayi:youtube-caption-request";
export const YOUTUBE_BRIDGE_RESPONSE = "huayi:youtube-caption-response";
export const YOUTUBE_SOURCE_PROBE_REQUEST = "huayi:youtube-source-probe-request";
export const YOUTUBE_SOURCE_PROBE_RESPONSE = "huayi:youtube-source-probe-response";

export const MAX_TIMED_TEXT_BYTES = 2 * 1_024 * 1_024;
export const MAX_TIMED_TEXT_CUES = 50_000;

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_LANGUAGE_CODE_LENGTH = 32;
const MAX_KIND_LENGTH = 32;
const MAX_SEGMENTS_PER_CUE = 1_000;
const MAX_SEGMENT_TEXT_LENGTH = 16_384;

export type YouTubeCaptionTarget = "source" | "translated";

export interface YouTubeBridgeRequest {
  type: typeof YOUTUBE_BRIDGE_REQUEST;
  requestId: string;
  generation: number;
  expectedVideoId: string;
  target: YouTubeCaptionTarget;
}

export interface YouTubeSourceProbeRequest {
  type: typeof YOUTUBE_SOURCE_PROBE_REQUEST;
  requestId: string;
  generation: number;
  expectedVideoId: string;
}

export interface YouTubeSourceProbeResponse {
  type: typeof YOUTUBE_SOURCE_PROBE_RESPONSE;
  requestId: string;
  generation: number;
  expectedVideoId: string;
  status: YouTubeSourceStatus;
}

export type YouTubeSourceStatus =
  "same-source" | "different-english" | "non-english" | "unavailable";

export interface YouTubeTrackMetadata {
  languageCode: string;
  kind?: string;
}

export interface YouTubeTimedTextFingerprint {
  host: "youtube.com" | "www.youtube.com" | "m.youtube.com";
  path: "/api/timedtext";
  v: string;
  lang: string;
  kind?: string;
  tlang?: "zh-Hans";
  fmt: "json3";
}

interface YouTubeBridgeResponseEnvelope {
  type: typeof YOUTUBE_BRIDGE_RESPONSE;
  requestId: string;
  generation: number;
  expectedVideoId: string;
  target: YouTubeCaptionTarget;
}

export interface YouTubeBridgeSuccessResponse extends YouTubeBridgeResponseEnvelope {
  ok: true;
  videoId: string;
  track: YouTubeTrackMetadata;
  fingerprint: YouTubeTimedTextFingerprint;
  body: string;
}

export type YouTubeBridgeError = "unavailable" | "timeout" | "invalid-response" | "stale";

export interface YouTubeBridgeFailureResponse extends YouTubeBridgeResponseEnvelope {
  ok: false;
  error: YouTubeBridgeError;
}

export type YouTubeBridgeResponse = YouTubeBridgeSuccessResponse | YouTubeBridgeFailureResponse;

export interface TimedTextCue {
  startMs: number;
  endMs: number;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isBoundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    /^[\w.-]+$/u.test(value)
  );
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function isTarget(value: unknown): value is YouTubeCaptionTarget {
  return value === "source" || value === "translated";
}

export function parseBridgeRequest(value: unknown): YouTubeBridgeRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["type", "requestId", "generation", "expectedVideoId", "target"]) ||
    value.type !== YOUTUBE_BRIDGE_REQUEST ||
    !isBoundedIdentifier(value.requestId) ||
    !isGeneration(value.generation) ||
    !isBoundedIdentifier(value.expectedVideoId) ||
    !isTarget(value.target)
  ) {
    return null;
  }
  return value as unknown as YouTubeBridgeRequest;
}

export function parseSourceProbeRequest(value: unknown): YouTubeSourceProbeRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["type", "requestId", "generation", "expectedVideoId"]) ||
    value.type !== YOUTUBE_SOURCE_PROBE_REQUEST ||
    !isBoundedIdentifier(value.requestId) ||
    !isGeneration(value.generation) ||
    !isBoundedIdentifier(value.expectedVideoId)
  ) {
    return null;
  }
  return value as unknown as YouTubeSourceProbeRequest;
}

export function parseSourceProbeResponse(value: unknown): YouTubeSourceProbeResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["type", "requestId", "generation", "expectedVideoId", "status"]) ||
    value.type !== YOUTUBE_SOURCE_PROBE_RESPONSE ||
    !isBoundedIdentifier(value.requestId) ||
    !isGeneration(value.generation) ||
    !isBoundedIdentifier(value.expectedVideoId) ||
    (value.status !== "same-source" &&
      value.status !== "different-english" &&
      value.status !== "non-english" &&
      value.status !== "unavailable")
  ) {
    return null;
  }
  return value as unknown as YouTubeSourceProbeResponse;
}

function finiteNonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function parseTimedTextBody(value: string): TimedTextCue[] | null {
  if (utf8Length(value) > MAX_TIMED_TEXT_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.events) ||
    parsed.events.length > MAX_TIMED_TEXT_CUES
  ) {
    return null;
  }

  const pending: { startMs: number; durationMs: number | null; text: string }[] = [];
  for (const event of parsed.events) {
    if (
      !isRecord(event) ||
      !Array.isArray(event.segs) ||
      event.segs.length > MAX_SEGMENTS_PER_CUE
    ) {
      continue;
    }
    const startMs = finiteNonnegativeNumber(event.tStartMs);
    const durationMs =
      event.dDurationMs === undefined ? null : finiteNonnegativeNumber(event.dDurationMs);
    if (startMs === null || (event.dDurationMs !== undefined && durationMs === null)) continue;
    let text = "";
    for (const segment of event.segs) {
      if (!isRecord(segment) || typeof segment.utf8 !== "string") continue;
      if (segment.utf8.length > MAX_SEGMENT_TEXT_LENGTH) return null;
      text += segment.utf8;
    }
    text = text.replace(/\s+/gu, " ").trim();
    if (text.length > 0) pending.push({ startMs, durationMs, text });
  }
  pending.sort((first, second) => first.startMs - second.startMs);
  const cues = pending.map((cue, index) => ({
    startMs: cue.startMs,
    endMs:
      cue.startMs +
      (cue.durationMs ??
        Math.max(0, (pending[index + 1]?.startMs ?? cue.startMs + 5_000) - cue.startMs)),
    text: cue.text,
  }));
  return cues.length > 0 ? cues : null;
}

function parseTrack(value: unknown): YouTubeTrackMetadata | null {
  if (!isRecord(value)) return null;
  const keys = value.kind === undefined ? ["languageCode"] : ["languageCode", "kind"];
  if (
    !hasExactKeys(value, keys) ||
    typeof value.languageCode !== "string" ||
    value.languageCode.length === 0 ||
    value.languageCode.length > MAX_LANGUAGE_CODE_LENGTH ||
    (value.kind !== undefined &&
      (typeof value.kind !== "string" || value.kind.length > MAX_KIND_LENGTH))
  ) {
    return null;
  }
  return value as unknown as YouTubeTrackMetadata;
}

function parseFingerprint(
  value: unknown,
  target: YouTubeCaptionTarget,
): YouTubeTimedTextFingerprint | null {
  if (!isRecord(value)) return null;
  const optional = [
    value.kind === undefined ? null : "kind",
    value.tlang === undefined ? null : "tlang",
  ].filter((key): key is string => key !== null);
  if (
    !hasExactKeys(value, ["host", "path", "v", "lang", "fmt", ...optional]) ||
    (value.host !== "youtube.com" &&
      value.host !== "www.youtube.com" &&
      value.host !== "m.youtube.com") ||
    value.path !== "/api/timedtext" ||
    !isBoundedIdentifier(value.v) ||
    typeof value.lang !== "string" ||
    value.lang.length === 0 ||
    value.lang.length > MAX_LANGUAGE_CODE_LENGTH ||
    (value.kind !== undefined &&
      (typeof value.kind !== "string" || value.kind.length > MAX_KIND_LENGTH)) ||
    value.fmt !== "json3" ||
    (target === "source" ? value.tlang !== undefined : value.tlang !== "zh-Hans")
  ) {
    return null;
  }
  return value as unknown as YouTubeTimedTextFingerprint;
}

export function parseBridgeResponse(value: unknown): YouTubeBridgeResponse | null {
  if (!isRecord(value) || value.type !== YOUTUBE_BRIDGE_RESPONSE || !isTarget(value.target)) {
    return null;
  }
  const envelopeValid =
    isBoundedIdentifier(value.requestId) &&
    isGeneration(value.generation) &&
    isBoundedIdentifier(value.expectedVideoId);
  if (!envelopeValid) return null;
  if (value.ok === false) {
    if (
      !hasExactKeys(value, [
        "type",
        "requestId",
        "generation",
        "expectedVideoId",
        "target",
        "ok",
        "error",
      ]) ||
      (value.error !== "unavailable" &&
        value.error !== "timeout" &&
        value.error !== "invalid-response" &&
        value.error !== "stale")
    ) {
      return null;
    }
    return value as unknown as YouTubeBridgeFailureResponse;
  }
  if (
    value.ok !== true ||
    !hasExactKeys(value, [
      "type",
      "requestId",
      "generation",
      "expectedVideoId",
      "target",
      "ok",
      "videoId",
      "track",
      "fingerprint",
      "body",
    ]) ||
    !isBoundedIdentifier(value.videoId) ||
    typeof value.body !== "string" ||
    parseTimedTextBody(value.body) === null ||
    parseTrack(value.track) === null ||
    parseFingerprint(value.fingerprint, value.target) === null
  ) {
    return null;
  }
  const track = value.track as unknown as YouTubeTrackMetadata;
  const fingerprint = value.fingerprint as unknown as YouTubeTimedTextFingerprint;
  if (
    value.videoId !== value.expectedVideoId ||
    fingerprint.v !== value.expectedVideoId ||
    fingerprint.lang !== track.languageCode ||
    fingerprint.kind !== track.kind
  ) {
    return null;
  }
  return value as unknown as YouTubeBridgeSuccessResponse;
}
