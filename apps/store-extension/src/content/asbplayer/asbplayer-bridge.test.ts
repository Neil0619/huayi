import { afterEach, describe, expect, it, vi } from "vitest";
import { ASBPLAYER_BRIDGE, ASBPLAYER_ORIGIN } from "./asbplayer-bridge-contract.js";
import { AsbplayerBridgeClient } from "./asbplayer-bridge-client.js";
import { installAsbplayerMainBridge } from "./asbplayer-main-bridge.js";
import { adapterHarness, cue, TEST_URL } from "./asbplayer.test-support.js";
import { parseAsbplayerPlaybackContext } from "./asbplayer-location.js";
const nonce = "nonce-1234567890123456",
  channel = "channel-1234567890123456";
function message(data: unknown, origin = ASBPLAYER_ORIGIN, source: Window | null = window) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}
afterEach(() => vi.restoreAllMocks());
describe("asbplayer passive bridge", () => {
  it("replays the early bounded snapshot and clears it on disable without stale reactivation", () => {
    const { adapter, port } = adapterHarness();
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const destroy = installAsbplayerMainBridge({ window, createAdapter: () => adapter });
    port.send({ command: "subtitles", value: [cue()] });
    port.send({ command: "offset", value: 1500 });
    expect(post).not.toHaveBeenCalled();
    message({ bridge: ASBPLAYER_BRIDGE, type: "subscribe", nonce, channel });
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
      type: "snapshot",
      snapshot: { offsetKnown: true, cues: [{ startMs: 2500 }] },
    });
    message({ bridge: ASBPLAYER_BRIDGE, type: "disable", nonce, channel });
    const count = post.mock.calls.length;
    port.late({ command: "subtitles", value: [cue({ text: "stale" })] });
    expect(post).toHaveBeenCalledTimes(count);
    expect(adapter.getSnapshot().cues).toEqual([]);
    destroy();
  });
  it("validates origin/window/correlation, rejects private fields and stale sessions", () => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "subtitles", value: [cue()] });
    port.send({ command: "offset", value: 0 });
    vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const client = new AsbplayerBridgeClient(window, nonce, channel);
    const receive = vi.fn();
    client.subscribe(receive);
    client.start();
    const data = {
      bridge: ASBPLAYER_BRIDGE,
      type: "snapshot",
      nonce,
      channel,
      snapshot: adapter.getSnapshot(),
    };
    message(data, "https://evil.test");
    message(data, ASBPLAYER_ORIGIN, null);
    message({ ...data, nonce: "wrong" });
    expect(receive).not.toHaveBeenCalled();
    message(data);
    expect(receive).toHaveBeenCalledOnce();
    message({
      ...data,
      snapshot: { ...data.snapshot, session: data.snapshot.session + 1, revision: 0 },
    });
    message({ ...data, snapshot: { ...data.snapshot, revision: 999 } });
    expect(receive).toHaveBeenCalledTimes(2);
    message({ ...data, snapshot: { ...data.snapshot, session: 2, fileName: "private" } });
    expect(receive.mock.calls.at(-1)?.[0]).toMatchObject({ status: "invalidated", cues: [] });
    client.destroy();
    message(data);
    expect(receive).toHaveBeenCalledTimes(3);
  });
  it("disabling clears the old cache; re-enable acknowledges only a new waiting adapter", () => {
    const first = adapterHarness(),
      second = adapterHarness();
    let time = 0;
    const createAdapter = vi
      .fn()
      .mockReturnValueOnce(first.adapter)
      .mockReturnValueOnce(second.adapter);
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const destroy = installAsbplayerMainBridge({ window, createAdapter, now: () => time });
    first.port.send({ command: "subtitles", value: [cue()] });
    first.port.send({ command: "offset", value: 0 });
    message({ bridge: ASBPLAYER_BRIDGE, type: "subscribe", nonce, channel });
    message({ bridge: ASBPLAYER_BRIDGE, type: "disable", nonce, channel });
    time += 1000;
    message({ bridge: ASBPLAYER_BRIDGE, type: "subscribe", nonce: `${nonce}-new`, channel });
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
      nonce: `${nonce}-new`,
      snapshot: { status: "waiting", cues: [], offsetKnown: false },
    });
    first.port.late({ command: "subtitles", value: [cue({ text: "stale" })] });
    second.port.send({ command: "subtitlesUpdated", subtitles: [cue({ index: 0 })] });
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ snapshot: { status: "waiting" } });
    second.port.send({ command: "subtitles", value: [cue({ text: "New sentence." })] });
    second.port.send({ command: "offset", value: 0 });
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
      snapshot: { status: "ready", offsetKnown: true, cues: [{ text: "New sentence." }] },
    });
    destroy();
  });
  it("does not charge outgoing snapshot/state echoes against the subscription request limit", () => {
    const { adapter } = adapterHarness();
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const destroy = installAsbplayerMainBridge({
      window,
      createAdapter: () => adapter,
      now: () => 0,
    });
    for (let i = 0; i < 20; i += 1)
      message({
        bridge: ASBPLAYER_BRIDGE,
        type: "state",
        nonce,
        channel,
        session: 1,
        revision: i,
        playModes: [1],
      });
    message({ bridge: ASBPLAYER_BRIDGE, type: "subscribe", nonce, channel });
    expect(post).toHaveBeenCalledOnce();
    destroy();
  });
  it("rate limits expensive replay requests before serializing repeated snapshots", () => {
    const { adapter, port } = adapterHarness();
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const destroy = installAsbplayerMainBridge({
      window,
      createAdapter: () => adapter,
      now: () => 0,
    });
    port.send({ command: "subtitles", value: [cue()] });
    for (let i = 0; i < 100; i += 1)
      message({ bridge: ASBPLAYER_BRIDGE, type: "subscribe", nonce, channel });
    expect(post.mock.calls.length).toBeLessThanOrEqual(6);
    destroy();
  });
  it("correlates initial replay to the current context even when the old full message is queued", () => {
    const h = adapterHarness();
    let url = TEST_URL;
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    const destroy = installAsbplayerMainBridge({ window, createAdapter: () => h.adapter });
    h.port.send({ command: "subtitles", value: [cue({ text: "Old queued sentence." })] });
    h.port.send({ command: "offset", value: 0 });
    const client = new AsbplayerBridgeClient(window, nonce, channel, undefined, () =>
      parseAsbplayerPlaybackContext(url, "top-level"),
    );
    const receive = vi.fn();
    client.subscribe(receive);
    client.start();
    message(post.mock.calls.at(-1)?.[0]);
    const queued = post.mock.calls.at(-1)?.[0];
    url = TEST_URL.replace("7fe82f76", "8fe82f76").replace("test-channel", "new-channel");
    h.navigate(url);
    message(queued);
    expect(receive).not.toHaveBeenCalled();
    const subscription = post.mock.calls.at(-1)?.[0];
    expect(subscription).toMatchObject({ type: "subscribe" });
    expect(subscription.nonce).not.toBe(nonce);
    message(subscription);
    message(post.mock.calls.at(-1)?.[0]);
    expect(receive).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "waiting", cues: [], offsetKnown: false }),
    );
    h.ports.at(-1)?.send({ command: "subtitles", value: [cue({ text: "Fresh sentence." })] });
    message(post.mock.calls.at(-1)?.[0]);
    h.ports.at(-1)?.send({ command: "offset", value: 0 });
    message(post.mock.calls.at(-1)?.[0]);
    expect(receive).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ready", offsetKnown: true }),
    );
    const count = receive.mock.calls.length;
    message(queued);
    expect(receive).toHaveBeenCalledTimes(count);
    client.destroy();
    destroy();
  });
});
