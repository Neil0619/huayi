export interface LocalCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}
export interface LocalSentence extends LocalCue {
  readonly id: number;
  readonly complete: boolean;
}
const MAX_SEGMENTS = 100_000;
const END = /[.!?]+["'’”\])}]*$/u;

/** Local subtitle files are not rolling ASR: repetitions and overlaps are intentional. */
export function segmentLocalCues(cues: readonly LocalCue[]): LocalSentence[] {
  const result: LocalSentence[] = [];
  let current: LocalCue | null = null;
  let fragment = false;
  let continuation = false;
  const flush = (preserveContinuation = false) => {
    if (current !== null)
      result.push({ ...current, id: result.length, complete: !fragment && END.test(current.text) });
    continuation = preserveContinuation && current !== null && !END.test(current.text);
    current = null;
    fragment = continuation;
  };
  const ordered = [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (let i = 0; i < ordered.length; i += 1) {
    const cue = ordered[i];
    if (!cue || cue.endMs <= cue.startMs) continue;
    const text = cue.text.normalize("NFC").replace(/\s+/gu, " ").trim();
    if (!text) continue;
    const next = ordered[i + 1];
    const previous = ordered[i - 1];
    const overlaps =
      (previous !== undefined && previous.endMs > cue.startMs) ||
      (current !== null && cue.startMs < current.endMs) ||
      (next !== undefined && next.startMs < cue.endMs);
    const points = [...text];
    const parts = Math.max(
      Math.ceil(points.length / 200),
      Math.ceil((cue.endMs - cue.startMs) / 15000),
    );
    if (parts + result.length > MAX_SEGMENTS) return [];
    if (parts > 1) {
      flush();
      // Split on whitespace where possible; timings remain inside the original interval.
      let remaining = text;
      let consumed = 0;
      while (remaining) {
        let count = Math.min([...remaining].length, Math.ceil(points.length / parts));
        const prefix = [...remaining].slice(0, count).join("");
        const space = [...prefix].lastIndexOf(" ");
        if (space > count / 2 && count < [...remaining].length) count = space + 1;
        const slice = [...remaining].slice(0, count).join("");
        const startMs = cue.startMs + ((cue.endMs - cue.startMs) * consumed) / points.length;
        consumed += count;
        const endMs = cue.startMs + ((cue.endMs - cue.startMs) * consumed) / points.length;
        const timeParts = Math.ceil((endMs - startMs) / 15000);
        if (timeParts + result.length > MAX_SEGMENTS) return [];
        for (let part = 0; part < timeParts; part += 1) {
          result.push({
            id: result.length,
            startMs: startMs + ((endMs - startMs) * part) / timeParts,
            endMs: startMs + ((endMs - startMs) * (part + 1)) / timeParts,
            text: slice.trim(),
            complete: false,
          });
        }
        remaining = [...remaining].slice(count).join("");
      }
      continuation = !END.test(text);
      fragment = continuation;
      continue;
    }
    if (
      current !== null &&
      (overlaps ||
        cue.startMs - current.endMs >= 1500 ||
        [...`${current.text} ${text}`].length > 120 ||
        cue.endMs - current.startMs > 12000)
    )
      flush(!overlaps && cue.startMs - current.endMs < 1500);
    if (current === null && previous && (overlaps || cue.startMs - previous.endMs >= 1500))
      fragment = false;
    current =
      current === null
        ? { ...cue, text }
        : { startMs: current.startMs, endMs: cue.endMs, text: `${current.text} ${text}` };
    if (
      overlaps ||
      END.test(text) ||
      [...current.text].length >= 120 ||
      current.endMs - current.startMs >= 12000
    )
      flush(!overlaps && !END.test(text));
  }
  flush();
  return result;
}

interface IntervalNode<T> {
  readonly center: number;
  readonly starts: readonly T[];
  readonly ends: readonly T[];
  readonly left: IntervalNode<T> | null;
  readonly right: IntervalNode<T> | null;
}
/** Centered interval tree: point and overlap queries visit O(log n + returned intervals). */
export function createSubtitleIndex<T extends LocalCue>(cues: readonly T[]) {
  function build(items: readonly T[]): IntervalNode<T> | null {
    if (!items.length) return null;
    const sorted = [...items].sort((a, b) => a.startMs - b.startMs);
    const center = sorted[Math.floor(sorted.length / 2)]?.startMs ?? 0;
    const left: T[] = [],
      right: T[] = [],
      crossing: T[] = [];
    for (const item of sorted) {
      if (item.endMs <= center) left.push(item);
      else if (item.startMs > center) right.push(item);
      else crossing.push(item);
    }
    return {
      center,
      starts: crossing,
      ends: [...crossing].sort((a, b) => b.endMs - a.endMs),
      left: build(left),
      right: build(right),
    };
  }
  const root = build(cues.filter((cue) => cue.endMs > cue.startMs));
  function overlapping(start: number, end: number): T[] {
    const found: T[] = [];
    function visit(node: IntervalNode<T> | null): void {
      if (!node) return;
      if (end <= node.center) {
        for (const item of node.starts) {
          if (item.startMs >= end) break;
          found.push(item);
        }
        visit(node.left);
      } else if (start >= node.center) {
        for (const item of node.ends) {
          if (item.endMs <= start) break;
          found.push(item);
        }
        visit(node.right);
      } else {
        found.push(...node.starts);
        visit(node.left);
        visit(node.right);
      }
    }
    visit(root);
    return found;
  }
  function at(time: number): T[] {
    const found: T[] = [];
    let node = root;
    while (node) {
      if (time < node.center) {
        for (const item of node.starts) {
          if (item.startMs > time) break;
          found.push(item);
        }
        node = node.left;
      } else {
        for (const item of node.ends) {
          if (item.endMs <= time) break;
          found.push(item);
        }
        node = node.right;
      }
    }
    return found;
  }
  return { overlapping, at };
}
