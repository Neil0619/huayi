import type { AsbplayerCue } from "./asbplayer-snapshot.js";
import type { LocalCue } from "../subtitles/local-subtitles.js";
const HAN = /\p{Script=Han}/u;
const LATIN = /[A-Za-z]/u;
export function describeAsbplayerTracks(cues: readonly AsbplayerCue[]) {
  const tracks = new Map<number, string>();
  for (const cue of cues) {
    if (tracks.has(cue.track) || !cue.text.trim()) continue;
    tracks.set(cue.track, cue.text.replace(/\s+/gu, " ").slice(0, 64));
  }
  return [...tracks].map(([index, preview]) => ({
    index,
    label: `轨道 ${index + 1} · ${preview}`,
  }));
}
export function prepareAsbplayerTracks(
  cues: readonly AsbplayerCue[],
  englishTrack: number,
  chineseTrack: number | null,
): { english: LocalCue[]; chinese: LocalCue[]; native: LocalCue[] } | null {
  const english: LocalCue[] = [],
    chinese: LocalCue[] = [],
    native: LocalCue[] = [];
  let bilingualEvidence = false;
  for (const cue of cues) {
    if (cue.track !== englishTrack && cue.track !== chineseTrack) continue;
    if (!cue.text.trim()) continue;
    if (englishTrack === chineseTrack) {
      const lines = cue.text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      const en = lines.filter((line) => LATIN.test(line) && !HAN.test(line));
      const zh = lines.filter((line) => HAN.test(line));
      // Never extract English from a mixed line or discard credits/unknown text.
      // The caller restores the complete native display during these cue intervals.
      if (!en.length || en.length + zh.length !== lines.length) {
        native.push(cue);
        continue;
      }
      english.push({ ...cue, text: en.join(" ") });
      if (zh.length) {
        chinese.push({ ...cue, text: zh.join(" ") });
        bilingualEvidence = true;
      }
    } else if (cue.track === englishTrack) {
      if (HAN.test(cue.text) || !LATIN.test(cue.text)) return null;
      english.push(cue);
    } else chinese.push(cue);
  }
  return english.length && (englishTrack !== chineseTrack || bilingualEvidence)
    ? { english, chinese, native }
    : null;
}
