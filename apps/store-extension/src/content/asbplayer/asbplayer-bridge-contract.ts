import {
  isRecord,
  isTimestamp,
  parseAsbplayerCues,
  parseAsbplayerPlayback,
  parseAsbplayerPlayModes,
  snapshotFitsBudget,
  type AsbplayerSnapshot,
} from "./asbplayer-snapshot.js";
export const ASBPLAYER_BRIDGE = "seen-said/asbplayer-v1";
export const ASBPLAYER_ORIGIN = "https://app.asbplayer.dev";
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
export function bridgeId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{16,64}$/u.test(value);
}
export function parseBridgeSnapshot(value: unknown): AsbplayerSnapshot | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "status",
      "reason",
      "session",
      "revision",
      "offsetMs",
      "offsetKnown",
      "cues",
      "playback",
      "playModes",
    ])
  )
    return null;
  if (
    !Number.isSafeInteger(value.session) ||
    Number(value.session) < 1 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !isTimestamp(value.offsetMs) ||
    typeof value.offsetKnown !== "boolean"
  )
    return null;
  if (
    typeof value.status !== "string" ||
    !["waiting", "ready", "invalidated"].includes(value.status) ||
    ![null, "invalid-context", "invalid-message", "channel-unavailable", "closed"].includes(
      value.reason as AsbplayerSnapshot["reason"],
    )
  )
    return null;
  if (!Array.isArray(value.cues) || value.cues.length > 50000) return null;
  const inputs = [];
  for (let i = 0; i < value.cues.length; i += 1) {
    const cue: unknown = value.cues[i];
    if (
      !isRecord(cue) ||
      !exactKeys(cue, [
        "index",
        "track",
        "text",
        "originalStartMs",
        "originalEndMs",
        "startMs",
        "endMs",
      ]) ||
      cue.index !== i ||
      !isTimestamp(cue.originalStartMs) ||
      !isTimestamp(cue.originalEndMs) ||
      cue.startMs !== cue.originalStartMs + value.offsetMs ||
      cue.endMs !== cue.originalEndMs + value.offsetMs
    )
      return null;
    inputs.push({
      text: cue.text,
      track: cue.track,
      originalStart: cue.originalStartMs,
      originalEnd: cue.originalEndMs,
    });
  }
  const parsed = parseAsbplayerCues(inputs, value.offsetMs);
  if (!parsed || (value.status !== "ready" && parsed.cues.length !== 0)) return null;
  let playback = null;
  if (value.playback !== null) {
    if (
      !isRecord(value.playback) ||
      !exactKeys(value.playback, [
        "timestampMs",
        "showingSubtitleIndexes",
        "hiddenSubtitleIndexes",
        "paused",
      ])
    )
      return null;
    playback = parseAsbplayerPlayback(value.playback, parsed.cues.length);
    if (!playback) return null;
  }
  const playModes = value.playModes === null ? null : parseAsbplayerPlayModes(value.playModes);
  if (value.playModes !== null && playModes === null) return null;
  const snapshot: AsbplayerSnapshot = Object.freeze({
    status: value.status as AsbplayerSnapshot["status"],
    reason: value.reason as AsbplayerSnapshot["reason"],
    session: Number(value.session),
    revision: Number(value.revision),
    offsetMs: value.offsetMs,
    offsetKnown: value.offsetKnown,
    cues: parsed.cues,
    playback,
    playModes,
  });
  return snapshotFitsBudget(snapshot, parsed.contentBytes) ? snapshot : null;
}
/** Correlation is not authentication: both worlds still validate every allowlisted payload. */
export interface AsbplayerBridgeRequest {
  readonly bridge: typeof ASBPLAYER_BRIDGE;
  readonly type: "subscribe" | "disable";
  readonly nonce: string;
  readonly channel: string;
}
export function parseBridgeRequest(value: unknown): AsbplayerBridgeRequest | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["bridge", "type", "nonce", "channel"]) ||
    value.bridge !== ASBPLAYER_BRIDGE ||
    (value.type !== "subscribe" && value.type !== "disable") ||
    !bridgeId(value.nonce) ||
    !bridgeId(value.channel)
  )
    return null;
  return { bridge: ASBPLAYER_BRIDGE, type: value.type, nonce: value.nonce, channel: value.channel };
}
export function createRateGate(limit: number, now = () => performance.now()): () => boolean {
  let start = -Infinity,
    count = 0;
  return () => {
    const time = now();
    if (time - start >= 1000) {
      start = time;
      count = 0;
    }
    count += 1;
    return count <= limit;
  };
}
