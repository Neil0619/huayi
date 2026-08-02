import { isEnglishText, normalizeSelectionText } from "../selection/detect-english.js";
import { isYouTubeHost } from "./caption-reader.js";

export interface TimedCaptionCue {
  endMs: number;
  startMs: number;
  text: string;
}

export type CaptionTranscriptFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type CaptionTranscriptValidator = (cues: TimedCaptionCue[]) => boolean;

interface CaptionTrackCandidate {
  baseUrl: string;
  automatic: boolean;
}

const PLAYER_RESPONSE_MARKER = "ytInitialPlayerResponse";
const MAX_INLINE_RESPONSE_LENGTH = 2 * 1_024 * 1_024;
const MAX_TRANSCRIPT_BYTES = 2 * 1_024 * 1_024;
const MAX_TRANSCRIPT_CUES = 50_000;
const DEFAULT_CUE_DURATION_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function jsonObjectAfterMarker(value: string, fromIndex = 0): string | null {
  const marker = value.indexOf(PLAYER_RESPONSE_MARKER, fromIndex);
  if (marker < 0) {
    return null;
  }
  const start = value.indexOf("{", marker + PLAYER_RESPONSE_MARKER.length);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let escaped = false;
  let quoted = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }
  return null;
}

function readTrackCandidatesFromSource(source: string): CaptionTrackCandidate[] {
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const marker = source.indexOf(PLAYER_RESPONSE_MARKER, searchFrom);
    if (marker < 0) break;
    searchFrom = marker + PLAYER_RESPONSE_MARKER.length;
    const rawResponse = jsonObjectAfterMarker(source, marker);
    if (rawResponse === null) {
      continue;
    }
    let response: unknown;
    try {
      response = JSON.parse(rawResponse);
    } catch {
      continue;
    }
    if (!isRecord(response) || !isRecord(response.captions)) {
      continue;
    }
    const renderer = response.captions.playerCaptionsTracklistRenderer;
    if (!isRecord(renderer) || !Array.isArray(renderer.captionTracks)) {
      continue;
    }
    const candidates: CaptionTrackCandidate[] = [];
    for (const track of renderer.captionTracks) {
      if (
        !isRecord(track) ||
        typeof track.baseUrl !== "string" ||
        typeof track.languageCode !== "string" ||
        !/^en(?:-|$)/iu.test(track.languageCode)
      ) {
        continue;
      }
      candidates.push({ baseUrl: track.baseUrl, automatic: track.kind === "asr" });
    }
    return candidates.sort((first, second) => Number(first.automatic) - Number(second.automatic));
  }
  return [];
}

function readTrackCandidates(documentRef: Document): CaptionTrackCandidate[] {
  for (const script of documentRef.querySelectorAll("script")) {
    const source = script.textContent ?? "";
    if (source.length === 0 || source.length > MAX_INLINE_RESPONSE_LENGTH) {
      continue;
    }
    const candidates = readTrackCandidatesFromSource(source);
    if (candidates.length > 0) return candidates;
  }
  return [];
}

function watchPageUrl(value: string | undefined): URL | null {
  if (value === undefined) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "https:" &&
    isYouTubeHost(url) &&
    url.pathname === "/watch" &&
    (url.searchParams.get("v")?.length ?? 0) > 0
    ? url
    : null;
}

function candidatesForVideo(
  candidates: CaptionTrackCandidate[],
  videoId: string,
): CaptionTrackCandidate[] {
  return candidates.filter((candidate) => {
    try {
      return new URL(candidate.baseUrl).searchParams.get("v") === videoId;
    } catch {
      return false;
    }
  });
}

function timedTextUrl(baseUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isYouTubeHost(url) || url.pathname !== "/api/timedtext") {
    return null;
  }
  url.searchParams.set("fmt", "json3");
  return url;
}

async function readBoundedResponse(response: Response): Promise<string | null> {
  if (!response.ok) {
    return null;
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_TRANSCRIPT_BYTES) {
      return null;
    }
  }
  if (response.body === null) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= MAX_TRANSCRIPT_BYTES ? text : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    total += chunk.value.byteLength;
    if (total > MAX_TRANSCRIPT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseTranscript(value: string): TimedCaptionCue[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.events) ||
    parsed.events.length > MAX_TRANSCRIPT_CUES
  ) {
    return null;
  }

  const pending: { durationMs: number | null; startMs: number; text: string }[] = [];
  for (const event of parsed.events) {
    if (!isRecord(event) || !Array.isArray(event.segs)) {
      continue;
    }
    const startMs = finiteNumber(event.tStartMs);
    const durationMs = event.dDurationMs === undefined ? null : finiteNumber(event.dDurationMs);
    if (startMs === null || (event.dDurationMs !== undefined && durationMs === null)) {
      continue;
    }
    const text = normalizeSelectionText(
      event.segs
        .filter(isRecord)
        .map((segment) => (typeof segment.utf8 === "string" ? segment.utf8 : ""))
        .join(""),
    ).replace(/\s+/gu, " ");
    if (text.length === 0 || !isEnglishText(text)) {
      continue;
    }
    pending.push({ durationMs, startMs, text });
  }
  pending.sort((first, second) => first.startMs - second.startMs);
  const cues = pending
    .map((cue, index) => {
      const nextStart = pending[index + 1]?.startMs;
      const endMs =
        cue.durationMs !== null
          ? cue.startMs + cue.durationMs
          : (nextStart ?? cue.startMs + DEFAULT_CUE_DURATION_MS);
      return Number.isFinite(endMs)
        ? { endMs: Math.max(cue.startMs, endMs), startMs: cue.startMs, text: cue.text }
        : null;
    })
    .filter((cue): cue is TimedCaptionCue => cue !== null);
  return cues.length === 0 ? null : cues;
}

export async function loadYouTubeCaptionTranscript(
  documentRef: Document,
  fetchImpl: CaptionTranscriptFetch,
  signal: AbortSignal,
  validate: CaptionTranscriptValidator = () => true,
  currentPageUrl = documentRef.URL,
): Promise<TimedCaptionCue[] | null> {
  const pageUrl = watchPageUrl(currentPageUrl);
  let candidates = readTrackCandidates(documentRef);
  if (pageUrl !== null) {
    candidates = candidatesForVideo(candidates, pageUrl.searchParams.get("v") ?? "");
  }
  if (candidates.length === 0) {
    if (pageUrl === null) return null;
    try {
      const pageResponse = await fetchImpl(pageUrl, {
        credentials: "omit",
        method: "GET",
        redirect: "error",
        signal,
      });
      const pageSource = await readBoundedResponse(pageResponse);
      if (pageSource === null) return null;
      candidates = candidatesForVideo(
        readTrackCandidatesFromSource(pageSource),
        pageUrl.searchParams.get("v") ?? "",
      );
    } catch {
      return null;
    }
  }

  for (const candidate of candidates) {
    const url = timedTextUrl(candidate.baseUrl);
    if (url === null) {
      continue;
    }
    try {
      const response = await fetchImpl(url, {
        credentials: "omit",
        method: "GET",
        redirect: "error",
        signal,
      });
      const body = await readBoundedResponse(response);
      if (body === null) {
        continue;
      }
      const cues = parseTranscript(body);
      if (cues !== null && validate(cues)) {
        return cues;
      }
    } catch {
      if (signal.aborted) {
        return null;
      }
    }
  }
  return null;
}
