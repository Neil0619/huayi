import { describe, expect, it, vi } from "vitest";
import { MediaPauseOwnership } from "./media-pause-ownership.js";
function harness(mode: readonly number[] | null = [1], paused = false, queued = false) {
  const video = document.createElement("video");
  const events: Event[] = [];
  const emit = (type: string) => {
    const event = new Event(type);
    if (queued) events.push(event);
    else video.dispatchEvent(event);
  };
  Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
  vi.spyOn(video, "pause").mockImplementation(() => {
    paused = true;
    emit("pause");
  });
  vi.spyOn(video, "play").mockImplementation(async () => {
    paused = false;
    emit("play");
  });
  const current = { video: video as HTMLVideoElement | null, generation: 1 };
  const owner = new MediaPauseOwnership(
    () => current,
    () => mode,
  );
  owner.bind();
  return {
    video,
    owner,
    current,
    flush: () => {
      for (const event of events.splice(0)) video.dispatchEvent(event);
    },
  };
}
describe("media pause ownership", () => {
  it("resumes when a preceding play event arrives after the owned pause", async () => {
    const h = harness([1], true, true);
    await h.video.play();
    h.owner.acquire("hold");
    h.flush();
    expect(h.video.paused).toBe(true);
    h.owner.release("hold");
    expect(h.video.paused).toBe(false);
    h.owner.destroy();
  });
  it("keeps a later user pause even when all media events arrive afterward", async () => {
    const h = harness([1], true, true);
    await h.video.play();
    h.owner.acquire("hold");
    await h.video.play();
    h.video.pause();
    h.flush();
    h.owner.release("hold");
    expect(h.video.paused).toBe(true);
    h.owner.destroy();
  });
  it("transfers hold to selection and resumes only after the last owner releases", () => {
    const h = harness();
    h.owner.acquire("hold");
    h.owner.acquire("selection");
    h.owner.release("hold");
    expect(h.video.pause).toHaveBeenCalledOnce();
    expect(h.video.play).not.toHaveBeenCalled();
    h.owner.release("selection");
    expect(h.video.play).toHaveBeenCalledOnce();
    h.owner.destroy();
  });
  it.each([null, [2], [3], [4], [5], [], [1, 3]])(
    "never resumes unconfirmed or non-normal mode %j",
    (mode) => {
      const h = harness(mode);
      h.owner.acquire("selection");
      h.owner.release("selection");
      expect(h.video.play).not.toHaveBeenCalled();
      h.owner.destroy();
    },
  );
  it("does not own an already paused video", () => {
    const h = harness([1], true);
    h.owner.acquire("selection");
    h.owner.release("selection");
    expect(h.video.play).not.toHaveBeenCalled();
    h.owner.destroy();
  });
  it.each(["play", "pause", "seeking", "emptied"])("revokes after user/media %s", (type) => {
    const h = harness();
    h.owner.acquire("selection");
    h.video.dispatchEvent(new Event(type));
    h.owner.release("selection");
    expect(h.video.play).not.toHaveBeenCalled();
    h.owner.destroy();
  });
  it("rejects stale callbacks after media generation replacement", () => {
    const h = harness();
    h.owner.acquire("selection");
    h.current.generation += 1;
    h.owner.release("selection");
    expect(h.video.play).not.toHaveBeenCalled();
    h.owner.destroy();
  });
});
