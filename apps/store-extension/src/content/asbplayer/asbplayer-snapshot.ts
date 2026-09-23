export const MAX_ASBPLAYER_SNAPSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_ASBPLAYER_CUES = 50_000;
export const MAX_ASBPLAYER_TRACKS = 8;
export const MAX_ASBPLAYER_TEXT_LENGTH = 2000;

export interface AsbplayerCue {
  readonly index: number;
  readonly track: number;
  readonly text: string;
  readonly originalStartMs: number;
  readonly originalEndMs: number;
  readonly startMs: number;
  readonly endMs: number;
}

export interface AsbplayerPlaybackState {
  readonly timestampMs: number;
  readonly showingSubtitleIndexes: readonly number[];
  readonly hiddenSubtitleIndexes: readonly number[];
  readonly paused: boolean;
}

export type AsbplayerInvalidationReason =
  "invalid-context" | "invalid-message" | "channel-unavailable" | "closed";

export interface AsbplayerSnapshot {
  readonly status: "waiting" | "ready" | "invalidated";
  readonly reason: AsbplayerInvalidationReason | null;
  readonly session: number;
  readonly revision: number;
  readonly offsetMs: number;
  readonly offsetKnown: boolean;
  readonly cues: readonly AsbplayerCue[];
  readonly playback: AsbplayerPlaybackState | null;
  readonly playModes: readonly number[] | null;
}

export interface AsbplayerCueCollection {
  readonly cues: readonly AsbplayerCue[];
  /** UTF-8 bytes inside the JSON array, including separators but excluding brackets. */
  readonly contentBytes: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER
  );
}

function isIndex(value: unknown, length: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < length;
}

function cueFromValue(value: unknown, index: number, offsetMs: number): AsbplayerCue | null {
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    value.text.length > MAX_ASBPLAYER_TEXT_LENGTH ||
    !isTimestamp(value.originalStart) ||
    value.originalStart < 0 ||
    !isTimestamp(value.originalEnd) ||
    value.originalEnd < value.originalStart ||
    !isIndex(value.track, MAX_ASBPLAYER_TRACKS)
  )
    return null;
  const startMs = value.originalStart + offsetMs;
  const endMs = value.originalEnd + offsetMs;
  if (!isTimestamp(startMs) || !isTimestamp(endMs)) return null;
  // start/end in upstream messages may already contain an offset. Never use them.
  return Object.freeze({
    index,
    track: value.track,
    text: value.text,
    originalStartMs: value.originalStart,
    originalEndMs: value.originalEnd,
    startMs,
    endMs,
  });
}

export function collectAsbplayerCues(cues: readonly AsbplayerCue[]): AsbplayerCueCollection | null {
  let contentBytes = Math.max(0, cues.length - 1);
  const encoder = new TextEncoder();
  for (const cue of cues) {
    contentBytes += encoder.encode(JSON.stringify(cue)).byteLength;
    if (contentBytes > MAX_ASBPLAYER_SNAPSHOT_BYTES) return null;
  }
  return { cues: Object.freeze(cues), contentBytes };
}

export function parseAsbplayerCues(
  value: unknown,
  offsetMs: number,
): AsbplayerCueCollection | null {
  if (!Array.isArray(value) || value.length > MAX_ASBPLAYER_CUES) return null;
  const cues: AsbplayerCue[] = [];
  // Check bytes incrementally, without serializing any unrelated input fields.
  let contentBytes = Math.max(0, value.length - 1);
  const encoder = new TextEncoder();
  for (let index = 0; index < value.length; index += 1) {
    const cue = cueFromValue(value[index], index, offsetMs);
    if (cue === null) return null;
    contentBytes += encoder.encode(JSON.stringify(cue)).byteLength;
    if (contentBytes > MAX_ASBPLAYER_SNAPSHOT_BYTES) return null;
    cues.push(cue);
  }
  return { cues: Object.freeze(cues), contentBytes };
}

export function updateAsbplayerCues(
  value: unknown,
  previous: readonly AsbplayerCue[],
  offsetMs: number,
): AsbplayerCueCollection | null {
  if (!Array.isArray(value) || value.length > previous.length) return null;
  const replacements = new Map<number, AsbplayerCue>();
  for (const item of value) {
    if (!isRecord(item) || !isIndex(item.index, previous.length) || replacements.has(item.index))
      return null;
    const oldCue = previous[item.index];
    const nextCue = cueFromValue(item, item.index, offsetMs);
    if (
      oldCue === undefined ||
      nextCue === null ||
      nextCue.originalStartMs !== oldCue.originalStartMs ||
      nextCue.originalEndMs !== oldCue.originalEndMs ||
      nextCue.track !== oldCue.track
    )
      return null;
    replacements.set(item.index, nextCue);
  }
  return collectAsbplayerCues(previous.map((cue) => replacements.get(cue.index) ?? cue));
}

export function offsetAsbplayerCues(
  cues: readonly AsbplayerCue[],
  offsetMs: number,
): AsbplayerCueCollection | null {
  const shifted: AsbplayerCue[] = [];
  for (const cue of cues) {
    const startMs = cue.originalStartMs + offsetMs;
    const endMs = cue.originalEndMs + offsetMs;
    if (!isTimestamp(startMs) || !isTimestamp(endMs)) return null;
    shifted.push(Object.freeze({ ...cue, startMs, endMs }));
  }
  return collectAsbplayerCues(shifted);
}

function indexes(value: unknown, cueCount: number): readonly number[] | null {
  if (!Array.isArray(value) || value.length > cueCount) return null;
  const result = new Set<number>();
  for (const index of value) {
    if (!isIndex(index, cueCount) || result.has(index)) return null;
    result.add(index);
  }
  return Object.freeze([...result]);
}

export function parseAsbplayerPlayback(
  value: Record<string, unknown>,
  cueCount: number,
): AsbplayerPlaybackState | null {
  if (!isTimestamp(value.timestampMs) || value.timestampMs < 0 || typeof value.paused !== "boolean")
    return null;
  const showingSubtitleIndexes = indexes(value.showingSubtitleIndexes, cueCount);
  const hiddenSubtitleIndexes = indexes(value.hiddenSubtitleIndexes ?? [], cueCount);
  // Upstream reports hidden indexes as a mask over showing indexes, so overlap is valid.
  if (showingSubtitleIndexes === null || hiddenSubtitleIndexes === null) return null;
  return Object.freeze({
    timestampMs: value.timestampMs,
    showingSubtitleIndexes,
    hiddenSubtitleIndexes,
    paused: value.paused,
  });
}

export function parseAsbplayerPlayModes(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const modes = new Set<number>();
  for (const mode of value) {
    if (!isIndex(mode, 6) || mode === 0 || modes.has(mode)) return null;
    modes.add(mode);
  }
  return Object.freeze([...modes]);
}

export function snapshotFitsBudget(snapshot: AsbplayerSnapshot, contentBytes: number): boolean {
  const metadataBytes = new TextEncoder().encode(
    JSON.stringify({ ...snapshot, cues: [] }),
  ).byteLength;
  return metadataBytes + contentBytes <= MAX_ASBPLAYER_SNAPSHOT_BYTES;
}
