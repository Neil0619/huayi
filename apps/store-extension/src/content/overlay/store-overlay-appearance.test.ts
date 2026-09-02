import { beforeEach, describe, expect, it } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { click, reading, setup, shadow } from "./store-overlay-controller.test-support.js";

describe("Store overlay appearance", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it("uses one panel structure for the selectable pearl and parchment materials", () => {
    const { controller } = setup();
    controller.setTheme("pearl");
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    const pearl = shadow().querySelector<HTMLElement>(".panel");
    expect(pearl?.dataset.appearance).toBe("silver");
    expect(pearl?.dataset.theme).toBe("pearl");
    const pearlStructure = pearl?.innerHTML;

    controller.setTheme("parchment");
    expect(pearl?.dataset.theme).toBe("parchment");
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    const parchment = shadow().querySelector<HTMLElement>(".panel");
    expect(parchment?.dataset.theme).toBe("parchment");
    expect(parchment?.innerHTML).toBe(pearlStructure);
  });

  it("updates an open card appearance in place without losing streamed content", () => {
    const { controller, ports } = setup();
    controller.setAppearance("silver");
    controller.show(reading("early stages", "phrase"), { bottom: 80, left: 40, top: 60 });
    click("[data-action='translate']");
    ports[0]?.receive({
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/analysis-update",
      update: {
        requestId: "stream-1",
        section: "translation",
        sequence: 0,
        text: "早期",
        type: "delta",
      },
    });
    const host = document.querySelector<HTMLElement>("[data-huayi-store-overlay]");
    const panel = shadow().querySelector<HTMLElement>(".panel");

    controller.setAppearance("champagne");

    expect(document.querySelector("[data-huayi-store-overlay]")).toBe(host);
    expect(host?.dataset.appearance).toBe("champagne");
    expect(panel?.dataset.appearance).toBe("champagne");
    expect(shadow().textContent).toContain("早期");
    expect(ports).toHaveLength(1);
  });

  it("loads the packaged Shadow stylesheet and keeps an operable fallback on failure", () => {
    const { controller } = setup();
    controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
    const stylesheet = shadow().querySelector<HTMLLinkElement>("[data-overlay-stylesheet]");
    const panel = shadow().querySelector<HTMLElement>(".panel");
    expect(stylesheet?.href).toBe("chrome-extension://test/overlay.css");
    expect(panel?.dataset.styles).toBe("loading");
    stylesheet?.dispatchEvent(new Event("error"));
    expect(panel?.dataset.styles).toBe("fallback");
    expect(shadow().querySelectorAll("[data-action]")).toHaveLength(2);
    expect(shadow().querySelector("style")?.textContent).toContain("min-height:40px");
  });
});
