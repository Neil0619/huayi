import { afterEach, describe, expect, it } from "vitest";
import { reading, setup, click } from "./store-overlay-controller.test-support.js";
afterEach(() => {
  document.body.replaceChildren();
});
describe("optional subtitle overlay mount", () => {
  it("defaults ordinary page cards to body", () => {
    const { controller } = setup();
    controller.show(reading("test", "word"), { left: 20, top: 20, bottom: 40 });
    expect(controller.getHost()?.parentElement).toBe(document.body);
    controller.close();
  });
  it("relocates the same card, port and result state into/out of a fullscreen host", () => {
    const { controller, ports } = setup();
    const player = document.createElement("div");
    document.body.append(player);
    controller.show(reading("test", "word"), { left: 20, top: 20, bottom: 40 }, undefined, {
      mount: player,
    });
    const host = controller.getHost();
    click('[data-action="explain"]');
    expect(host?.parentElement).toBe(player);
    controller.relocate(null);
    expect(controller.getHost()).toBe(host);
    expect(host?.parentElement).toBe(document.body);
    expect(ports).toHaveLength(1);
    expect(ports[0]?.disconnect).not.toHaveBeenCalled();
    controller.close();
  });
});
