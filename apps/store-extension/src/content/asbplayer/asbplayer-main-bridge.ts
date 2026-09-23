import type { AsbplayerAdapter } from "./asbplayer-adapter.js";
import {
  ASBPLAYER_BRIDGE,
  ASBPLAYER_ORIGIN,
  createRateGate,
  parseBridgeRequest,
  parseBridgeSnapshot,
  type AsbplayerBridgeRequest,
} from "./asbplayer-bridge-contract.js";
import { isRecord, type AsbplayerSnapshot } from "./asbplayer-snapshot.js";
interface Options {
  readonly window: Window;
  readonly createAdapter: () => AsbplayerAdapter;
  readonly now?: () => number;
}
export function installAsbplayerMainBridge(options: Options): () => void {
  let adapter: AsbplayerAdapter | null = null;
  let unsubscribe: (() => void) | null = null;
  let binding: AsbplayerBridgeRequest | null = null;
  let last: AsbplayerSnapshot | null = null;
  let disposed = false;
  let suspended = false;
  const requests = createRateGate(6, options.now);
  function send(snapshot: AsbplayerSnapshot, full: boolean): void {
    if (!binding || disposed || suspended) return;
    const payload = full
      ? { snapshot }
      : { session: snapshot.session, revision: snapshot.revision, playModes: snapshot.playModes };
    options.window.postMessage(
      {
        bridge: ASBPLAYER_BRIDGE,
        type: full ? "snapshot" : "state",
        nonce: binding.nonce,
        channel: binding.channel,
        ...payload,
      },
      ASBPLAYER_ORIGIN,
    );
  }
  function receive(snapshot: AsbplayerSnapshot): void {
    if (disposed) return;
    const full =
      !last ||
      snapshot.cues !== last.cues ||
      snapshot.session !== last.session ||
      snapshot.status !== last.status ||
      snapshot.offsetKnown !== last.offsetKnown;
    if (full) {
      // Validate the outbound boundary too. Playback comes from the actual media in ISOLATED.
      const sanitized = parseBridgeSnapshot({ ...snapshot, playback: null });
      if (sanitized) send(sanitized, true);
    } else if (snapshot.playModes !== last?.playModes) send(snapshot, false);
    last = snapshot;
  }
  function enable(): void {
    if (adapter || disposed || suspended) return;
    adapter = options.createAdapter();
    unsubscribe = adapter.subscribe(receive);
    receive(adapter.getSnapshot());
  }
  function disable(): void {
    unsubscribe?.();
    unsubscribe = null;
    adapter?.dispose();
    adapter = null;
    last = null;
    binding = null;
  }
  function onMessage(event: MessageEvent<unknown>): void {
    if (
      disposed ||
      suspended ||
      event.source !== options.window ||
      event.origin !== ASBPLAYER_ORIGIN
    )
      return;
    const data = event.data;
    if (
      !isRecord(data) ||
      data.bridge !== ASBPLAYER_BRIDGE ||
      (data.type !== "subscribe" && data.type !== "disable")
    )
      return;
    const clearing =
      data.type === "disable" && data.nonce === binding?.nonce && data.channel === binding?.channel;
    if (!clearing && !requests()) return;
    const request = parseBridgeRequest(data);
    if (!request) return;
    if (request.type === "disable") {
      if (binding?.nonce === request.nonce && binding.channel === request.channel) disable();
      return;
    }
    binding = request;
    enable();
    adapter?.refreshContext();
    if (last) {
      const safe = parseBridgeSnapshot({ ...last, playback: null });
      if (safe) send(safe, true);
    }
  }
  options.window.addEventListener("message", onMessage);
  enable(); // Capture upstream one-shot broadcasts before ISOLATED document_idle.
  const timer = options.window.setInterval(() => adapter?.refreshContext(), 500);
  function destroy(): void {
    if (disposed) return;
    disposed = true;
    disable();
    options.window.clearInterval(timer);
    options.window.removeEventListener("message", onMessage);
    options.window.removeEventListener("pagehide", suspend);
    options.window.removeEventListener("pageshow", resume);
  }
  function suspend(): void {
    suspended = true;
    disable();
  }
  function resume(event: PageTransitionEvent): void {
    if (!event.persisted || disposed || !suspended) return;
    suspended = false;
    enable();
  }
  options.window.addEventListener("pagehide", suspend);
  options.window.addEventListener("pageshow", resume);
  return destroy;
}
