import {
  ASBPLAYER_BRIDGE,
  ASBPLAYER_ORIGIN,
  createRateGate,
  exactKeys,
  parseBridgeSnapshot,
} from "./asbplayer-bridge-contract.js";
import { isRecord, parseAsbplayerPlayModes, type AsbplayerSnapshot } from "./asbplayer-snapshot.js";
import {
  readAsbplayerPlaybackContext,
  sameAsbplayerContext,
  type AsbplayerPlaybackContext,
} from "./asbplayer-location.js";
export interface SubtitleSnapshot {
  subscribe(listener: (snapshot: AsbplayerSnapshot) => void): () => void;
  start(): void;
  destroy(): void;
  refreshContext?(): void;
}
export class AsbplayerBridgeClient implements SubtitleSnapshot {
  private snapshot: AsbplayerSnapshot | null = null;
  private readonly listeners = new Set<(snapshot: AsbplayerSnapshot) => void>();
  private started = false;
  private retiredSession = 0;
  private readonly gate: () => boolean;
  private context: AsbplayerPlaybackContext | null;
  constructor(
    private readonly view: Window,
    private nonce: string = crypto.randomUUID(),
    private channel: string = crypto.randomUUID(),
    now?: () => number,
    private readonly readContext = () => readAsbplayerPlaybackContext(view),
  ) {
    this.gate = createRateGate(12, now);
    this.context = this.readContext();
  }
  refreshContext(): void {
    const context = this.readContext();
    if (sameAsbplayerContext(context, this.context)) return;
    this.context = context;
    this.snapshot = null;
    this.retiredSession = 0;
    this.nonce = crypto.randomUUID();
    this.channel = crypto.randomUUID();
    if (this.started) this.post("subscribe");
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.view.addEventListener("message", this.receive);
    this.post("subscribe");
  }
  subscribe(listener: (snapshot: AsbplayerSnapshot) => void): () => void {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }
  destroy(): void {
    if (!this.started) return;
    this.post("disable");
    this.started = false;
    this.view.removeEventListener("message", this.receive);
    this.snapshot = null;
    this.listeners.clear();
  }
  private post(type: "subscribe" | "disable"): void {
    this.view.postMessage(
      { bridge: ASBPLAYER_BRIDGE, type, nonce: this.nonce, channel: this.channel },
      ASBPLAYER_ORIGIN,
    );
  }
  private readonly receive = (event: MessageEvent<unknown>): void => {
    if (
      !this.started ||
      event.source !== this.view ||
      event.origin !== ASBPLAYER_ORIGIN ||
      !isRecord(event.data)
    )
      return;
    this.refreshContext();
    const data = event.data;
    if (
      data.bridge !== ASBPLAYER_BRIDGE ||
      data.nonce !== this.nonce ||
      data.channel !== this.channel ||
      !["snapshot", "state"].includes(String(data.type))
    )
      return;
    if (!this.gate()) {
      this.invalidate();
      return;
    }
    let next: AsbplayerSnapshot | null = null;
    if (
      data.type === "snapshot" &&
      exactKeys(data, ["bridge", "type", "nonce", "channel", "snapshot"])
    )
      next = parseBridgeSnapshot(data.snapshot);
    if (
      data.type === "state" &&
      exactKeys(data, ["bridge", "type", "nonce", "channel", "session", "revision", "playModes"])
    ) {
      if (data.session !== this.snapshot?.session) return;
      const modes = data.playModes === null ? null : parseAsbplayerPlayModes(data.playModes);
      if (
        this.snapshot &&
        (modes !== null || data.playModes === null) &&
        Number.isSafeInteger(data.revision)
      )
        next = { ...this.snapshot, revision: Number(data.revision), playModes: modes };
    }
    if (!next) {
      this.invalidate();
      return;
    }
    if (
      next.session < this.retiredSession ||
      (this.snapshot && next.session < this.snapshot.session)
    )
      return;
    if (
      this.snapshot &&
      next.session === this.snapshot.session &&
      next.revision <= this.snapshot.revision
    )
      return;
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  };
  private invalidate(): void {
    if (!this.snapshot) return;
    this.retiredSession = this.snapshot.session + 1;
    this.snapshot = {
      ...this.snapshot,
      status: "invalidated",
      reason: "invalid-message",
      cues: [],
      playback: null,
      playModes: null,
      offsetKnown: false,
    };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
