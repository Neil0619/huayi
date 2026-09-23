import { createRateGate } from "./asbplayer-bridge-contract.js";
import { sameAsbplayerContext, type AsbplayerPlaybackContext } from "./asbplayer-location.js";
import {
  isRecord,
  isTimestamp,
  offsetAsbplayerCues,
  parseAsbplayerCues,
  parseAsbplayerPlayback,
  parseAsbplayerPlayModes,
  snapshotFitsBudget,
  updateAsbplayerCues,
  type AsbplayerCueCollection,
  type AsbplayerInvalidationReason,
  type AsbplayerSnapshot,
} from "./asbplayer-snapshot.js";

/** Intentionally has no postMessage capability: this adapter is a passive observer. */
export interface AsbplayerChannel {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

export interface AsbplayerAdapterOptions {
  readonly readContext: () => AsbplayerPlaybackContext | null;
  readonly createChannel: (name: string) => AsbplayerChannel;
}

export interface AsbplayerAdapter {
  getSnapshot(): AsbplayerSnapshot;
  subscribe(listener: (snapshot: AsbplayerSnapshot) => void): () => void;
  refreshContext(): void;
  dispose(): void;
}

/** Call at document_start, before the upstream one-shot subtitles broadcast. */
export function createAsbplayerAdapter(options: AsbplayerAdapterOptions): AsbplayerAdapter {
  let context: AsbplayerPlaybackContext | null = null;
  let initialized = false;
  let disposed = false;
  let session = 0;
  let revision = 0;
  let cueContentBytes = 0;
  const expensiveMessages = createRateGate(8);
  const smallMessages = createRateGate(120);
  let detach: (() => void) | undefined;
  const listeners = new Set<(snapshot: AsbplayerSnapshot) => void>();
  const usedChannels = new Set<string>();
  let snapshot = emptySnapshot("waiting", null);

  function emptySnapshot(
    status: AsbplayerSnapshot["status"],
    reason: AsbplayerInvalidationReason | null,
  ): AsbplayerSnapshot {
    return Object.freeze({
      status,
      reason,
      session,
      revision,
      offsetMs: 0,
      offsetKnown: false,
      cues: Object.freeze([]),
      playback: null,
      playModes: null,
    });
  }

  function publish(next: AsbplayerSnapshot, contentBytes = cueContentBytes): void {
    revision += 1;
    const candidate = { ...next, revision, session };
    if (!snapshotFitsBudget(candidate, contentBytes)) {
      cueContentBytes = 0;
      snapshot = emptySnapshot("invalidated", "invalid-message");
    } else {
      cueContentBytes = contentBytes;
      snapshot = Object.freeze(candidate);
    }
    for (const listener of listeners) listener(snapshot);
  }

  function invalidate(reason: AsbplayerInvalidationReason): void {
    publish(emptySnapshot("invalidated", reason), 0);
  }

  function disconnect(): void {
    detach?.();
    detach = undefined;
  }

  function acceptCues(collection: AsbplayerCueCollection | null, fullSnapshot: boolean): void {
    if (collection === null) {
      invalidate("invalid-message");
      return;
    }
    publish(
      {
        ...snapshot,
        cues: collection.cues,
        status: "ready",
        reason: null,
        playback: fullSnapshot ? null : snapshot.playback,
      },
      collection.contentBytes,
    );
  }

  function receive(data: unknown): void {
    if (!isRecord(data)) return;
    if (data.command === "offset" && data.value === snapshot.offsetMs && snapshot.offsetKnown)
      return;
    const largePlayback =
      data.command === "playbackState" &&
      [data.showingSubtitleIndexes, data.hiddenSubtitleIndexes].some(
        (value) => Array.isArray(value) && value.length > 64,
      );
    if (
      (["subtitles", "subtitlesUpdated", "offset"].includes(String(data.command)) ||
        largePlayback) &&
      !expensiveMessages()
    ) {
      invalidate("invalid-message");
      return;
    }
    if (["playbackState", "playModes"].includes(String(data.command)) && !smallMessages()) return;
    switch (data.command) {
      case "subtitles":
        acceptCues(parseAsbplayerCues(data.value, snapshot.offsetMs), true);
        break;
      case "subtitlesUpdated": {
        if (snapshot.status !== "ready") break;
        const toVideo = Object.hasOwn(data, "subtitles");
        const fromVideo = Object.hasOwn(data, "updatedSubtitles");
        if (toVideo === fromVideo) {
          invalidate("invalid-message");
          break;
        }
        acceptCues(
          updateAsbplayerCues(
            toVideo ? data.subtitles : data.updatedSubtitles,
            snapshot.cues,
            snapshot.offsetMs,
          ),
          false,
        );
        break;
      }
      case "offset": {
        if (!isTimestamp(data.value)) {
          invalidate("invalid-message");
          break;
        }
        if (data.value === snapshot.offsetMs && snapshot.offsetKnown) break;
        const shifted = offsetAsbplayerCues(snapshot.cues, data.value);
        if (shifted === null) {
          invalidate("invalid-message");
          break;
        }
        publish(
          { ...snapshot, cues: shifted.cues, offsetMs: data.value, offsetKnown: true },
          shifted.contentBytes,
        );
        break;
      }
      case "playbackState": {
        if (snapshot.status !== "ready") break;
        const playback = parseAsbplayerPlayback(data, snapshot.cues.length);
        if (playback === null) {
          invalidate("invalid-message");
          break;
        }
        publish({ ...snapshot, playback });
        break;
      }
      case "playModes": {
        const playModes = parseAsbplayerPlayModes(data.playModes);
        if (playModes === null) {
          invalidate("invalid-message");
          break;
        }
        publish({ ...snapshot, playModes });
        break;
      }
      case "close":
      case "exit":
        disconnect();
        invalidate("closed");
        break;
      // Other upstream commands include credentials/settings: do not inspect, retain or log.
      default:
        break;
    }
  }

  function refreshContext(): void {
    if (disposed) return;
    const next = options.readContext();
    if (initialized && sameAsbplayerContext(next, context)) return;
    initialized = true;
    disconnect();
    context = next;
    session += 1;
    publish(
      emptySnapshot(
        next === null ? "invalidated" : "waiting",
        next === null ? "invalid-context" : null,
      ),
      0,
    );
    if (next === null) return;
    // Upstream messages contain no session identifier; do not rejoin a retired channel.
    // The bound also caps private routing history retained for this document lifetime.
    if (usedChannels.has(next.channel) || usedChannels.size >= 64) {
      invalidate("invalid-context");
      return;
    }
    usedChannels.add(next.channel);
    const attachedSession = session;
    try {
      const channel = options.createChannel(next.channel);
      let active = true;
      const onMessage = (event: MessageEvent<unknown>): void => {
        if (!active || disposed) return;
        refreshContext();
        if (!active || attachedSession !== session) return;
        receive(event.data);
      };
      detach = () => {
        active = false;
        channel.removeEventListener("message", onMessage);
        channel.close();
      };
      channel.addEventListener("message", onMessage);
    } catch {
      disconnect();
      invalidate("channel-unavailable");
    }
  }

  refreshContext();
  return {
    getSnapshot: () => {
      refreshContext();
      return snapshot;
    },
    refreshContext,
    subscribe: (listener) => {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disconnect();
      if (snapshot.reason !== "closed") invalidate("closed");
      listeners.clear();
      usedChannels.clear();
      context = null;
    },
  };
}
