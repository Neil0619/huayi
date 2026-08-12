export const YOUTUBE_BRIDGE_SETUP = "huayi:store-youtube-bridge-setup";
export const YOUTUBE_BRIDGE_REQUEST = "huayi:store-youtube-caption-request";
export const YOUTUBE_BRIDGE_RESPONSE = "huayi:store-youtube-caption-response";

export const MAX_TIMED_TEXT_BYTES = 2 * 1_024 * 1_024;
export const MAX_TIMED_TEXT_CUES = 50_000;

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_LANGUAGE_CODE_LENGTH = 32;
const MAX_KIND_LENGTH = 32;
const MAX_SEGMENTS_PER_CUE = 1_000;
const MAX_SEGMENT_TEXT_LENGTH = 16_384;

export type YouTubeCaptionTarget = "source" | "translated";

export interface YouTubeBridgeCorrelation {
  readonly capability: string;
  readonly channel: string;
  readonly expectedVideoId: string;
  readonly generation: number;
  readonly requestId: string;
  readonly target: YouTubeCaptionTarget;
}

export interface YouTubeBridgeSetup {
  readonly capability: string;
  readonly channel: string;
  readonly type: typeof YOUTUBE_BRIDGE_SETUP;
}

export interface YouTubeBridgeRequest extends YouTubeBridgeCorrelation {
  readonly type: typeof YOUTUBE_BRIDGE_REQUEST;
}

export interface YouTubeTrackMetadata {
  readonly kind?: string;
  readonly languageCode: string;
}

export interface YouTubeTimedTextFingerprint {
  readonly fmt: "json3";
  readonly host: "youtube.com" | "www.youtube.com" | "m.youtube.com";
  readonly kind?: string;
  readonly lang: string;
  readonly path: "/api/timedtext";
  readonly tlang?: "zh-Hans";
  readonly v: string;
}

export interface TimedTextCue {
  readonly endMs: number;
  readonly startMs: number;
  readonly text: string;
}

export type YouTubeBridgeResponse =
  | (YouTubeBridgeCorrelation & {
      readonly body: string;
      readonly fingerprint: YouTubeTimedTextFingerprint;
      readonly ok: true;
      readonly track: YouTubeTrackMetadata;
      readonly type: typeof YOUTUBE_BRIDGE_RESPONSE;
    })
  | (YouTubeBridgeCorrelation & {
      readonly error: "invalid-response" | "stale" | "timeout" | "unavailable";
      readonly ok: false;
      readonly type: typeof YOUTUBE_BRIDGE_RESPONSE;
    });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function boundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    /^[\w.-]+$/u.test(value)
  );
}

function validGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validTarget(value: unknown): value is YouTubeCaptionTarget {
  return value === "source" || value === "translated";
}

function parseCorrelation(value: Record<string, unknown>): YouTubeBridgeCorrelation | null {
  if (
    !boundedIdentifier(value.capability) ||
    !boundedIdentifier(value.channel) ||
    !boundedIdentifier(value.expectedVideoId) ||
    !validGeneration(value.generation) ||
    !boundedIdentifier(value.requestId) ||
    !validTarget(value.target)
  ) {
    return null;
  }
  return {
    capability: value.capability,
    channel: value.channel,
    expectedVideoId: value.expectedVideoId,
    generation: value.generation,
    requestId: value.requestId,
    target: value.target,
  };
}

function sameCorrelation(
  actual: YouTubeBridgeCorrelation,
  expected: YouTubeBridgeCorrelation,
): boolean {
  return (
    actual.capability === expected.capability &&
    actual.channel === expected.channel &&
    actual.expectedVideoId === expected.expectedVideoId &&
    actual.generation === expected.generation &&
    actual.requestId === expected.requestId &&
    actual.target === expected.target
  );
}

export function parseBridgeSetup(value: unknown): YouTubeBridgeSetup | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["capability", "channel", "type"]) ||
    value.type !== YOUTUBE_BRIDGE_SETUP ||
    !boundedIdentifier(value.capability) ||
    !boundedIdentifier(value.channel)
  ) {
    return null;
  }
  return { capability: value.capability, channel: value.channel, type: YOUTUBE_BRIDGE_SETUP };
}

export function parseBridgeRequest(value: unknown): YouTubeBridgeRequest | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "capability",
      "channel",
      "expectedVideoId",
      "generation",
      "requestId",
      "target",
      "type",
    ]) ||
    value.type !== YOUTUBE_BRIDGE_REQUEST
  ) {
    return null;
  }
  const correlation = parseCorrelation(value);
  return correlation === null ? null : { ...correlation, type: YOUTUBE_BRIDGE_REQUEST };
}

function finiteNonnegative(value: unknown): number | null {
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
  const pending: { durationMs: number | null; startMs: number; text: string }[] = [];
  for (const event of parsed.events) {
    if (
      !isRecord(event) ||
      !Array.isArray(event.segs) ||
      event.segs.length > MAX_SEGMENTS_PER_CUE
    ) {
      return null;
    }
    const startMs = finiteNonnegative(event.tStartMs);
    const durationMs =
      event.dDurationMs === undefined ? null : finiteNonnegative(event.dDurationMs);
    if (startMs === null || (event.dDurationMs !== undefined && durationMs === null)) continue;
    let text = "";
    for (const segment of event.segs) {
      if (!isRecord(segment) || typeof segment.utf8 !== "string") continue;
      if (segment.utf8.length > MAX_SEGMENT_TEXT_LENGTH) return null;
      text += segment.utf8;
    }
    text = text.replace(/\s+/gu, " ").trim();
    if (text.length > 0) pending.push({ durationMs, startMs, text });
  }
  pending.sort((first, second) => first.startMs - second.startMs);
  const cues = pending.map((cue, index) => ({
    endMs:
      cue.startMs +
      (cue.durationMs ??
        Math.max(0, (pending[index + 1]?.startMs ?? cue.startMs + 5_000) - cue.startMs)),
    startMs: cue.startMs,
    text: cue.text,
  }));
  return cues.length === 0 ? null : cues;
}

function parseTrack(value: unknown): YouTubeTrackMetadata | null {
  if (!isRecord(value)) return null;
  const keys = value.kind === undefined ? ["languageCode"] : ["kind", "languageCode"];
  if (
    !exactKeys(value, keys) ||
    typeof value.languageCode !== "string" ||
    value.languageCode.length === 0 ||
    value.languageCode.length > MAX_LANGUAGE_CODE_LENGTH ||
    (value.kind !== undefined &&
      (typeof value.kind !== "string" || value.kind.length > MAX_KIND_LENGTH))
  ) {
    return null;
  }
  return {
    ...(value.kind === undefined ? {} : { kind: value.kind }),
    languageCode: value.languageCode,
  };
}

function parseFingerprint(
  value: unknown,
  correlation: YouTubeBridgeCorrelation,
  track: YouTubeTrackMetadata,
): YouTubeTimedTextFingerprint | null {
  if (!isRecord(value)) return null;
  const optional = [
    value.kind === undefined ? null : "kind",
    value.tlang === undefined ? null : "tlang",
  ].filter((key): key is string => key !== null);
  if (
    !exactKeys(value, ["fmt", "host", "lang", "path", "v", ...optional]) ||
    !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(String(value.host)) ||
    value.path !== "/api/timedtext" ||
    value.fmt !== "json3" ||
    value.v !== correlation.expectedVideoId ||
    value.lang !== track.languageCode ||
    value.kind !== track.kind ||
    (correlation.target === "source" ? value.tlang !== undefined : value.tlang !== "zh-Hans")
  ) {
    return null;
  }
  return value as unknown as YouTubeTimedTextFingerprint;
}

export function parseBridgeResponse(
  value: unknown,
  expected: YouTubeBridgeCorrelation,
): YouTubeBridgeResponse | null {
  if (!isRecord(value) || value.type !== YOUTUBE_BRIDGE_RESPONSE) return null;
  const correlation = parseCorrelation(value);
  if (correlation === null || !sameCorrelation(correlation, expected)) return null;
  const baseKeys = [
    "capability",
    "channel",
    "expectedVideoId",
    "generation",
    "ok",
    "requestId",
    "target",
    "type",
  ];
  if (value.ok === false) {
    if (
      !exactKeys(value, [...baseKeys, "error"]) ||
      !["invalid-response", "stale", "timeout", "unavailable"].includes(String(value.error))
    ) {
      return null;
    }
    return {
      ...correlation,
      error: value.error as "unavailable",
      ok: false,
      type: YOUTUBE_BRIDGE_RESPONSE,
    };
  }
  if (
    value.ok !== true ||
    !exactKeys(value, [...baseKeys, "body", "fingerprint", "track"]) ||
    typeof value.body !== "string"
  ) {
    return null;
  }
  const track = parseTrack(value.track);
  if (track === null || parseTimedTextBody(value.body) === null) return null;
  const fingerprint = parseFingerprint(value.fingerprint, correlation, track);
  return fingerprint === null
    ? null
    : {
        ...correlation,
        body: value.body,
        fingerprint,
        ok: true,
        track,
        type: YOUTUBE_BRIDGE_RESPONSE,
      };
}
