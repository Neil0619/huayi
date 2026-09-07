import { beforeEach, expect, it } from "vitest";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { click, reading, setup, shadow } from "./store-overlay-controller.test-support.js";
beforeEach(() => {
  document.body.replaceChildren();
});
it("keeps explicit stop available and dismisses outside without a close button", () => {
  const { controller, ports } = setup();
  controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
  click("[data-action='explain']");
  expect(shadow().querySelector("[data-close]")).toBeNull();
  expect(shadow().querySelector<HTMLButtonElement>("[data-stop]")?.hidden).toBe(false);
  click("[data-stop]");
  expect(ports[0]?.postMessage).toHaveBeenLastCalledWith({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/analysis-cancel",
  });
  expect(shadow().querySelector<HTMLButtonElement>("[data-stop]")?.disabled).toBe(true);
  expect(ports[0]?.disconnect).not.toHaveBeenCalled();
  expect(shadow().textContent).toContain("等待服务器确认");
  ports[0]?.receive({
    code: "cancelled",
    messageVersion: STORE_MESSAGE_VERSION,
    requestId: null,
    type: "store/analysis-error",
  });
  expect(shadow().querySelector<HTMLButtonElement>("[data-stop]")?.hidden).toBe(true);
  document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
  expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
});

function stopWithPreview() {
  const value = setup();
  value.controller.show(reading("calibrate", "word"), { bottom: 80, left: 40, top: 60 });
  click("[data-action='explain']");
  value.ports[0]?.receive({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/analysis-update",
    update: {
      requestId: "request-1",
      type: "delta",
      section: "contextual-analysis",
      sequence: 0,
      text: "此处指校准或调整。",
    },
  });
  click("[data-stop]");
  expect(shadow().textContent).toContain("等待服务器确认");
  return value;
}

it.each(["cancelled", "disconnect"] as const)(
  "removes the pending stop message after %s while retaining validated preview",
  (ending) => {
    const { ports } = stopWithPreview();
    if (ending === "disconnect") ports[0]?.drop();
    else
      ports[0]?.receive({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/analysis-error",
        requestId: "request-1",
        code: "cancelled",
      });
    const body = shadow().querySelector("[data-analysis-body]");
    expect(body?.textContent).toContain("此处指校准或调整。");
    expect(body?.textContent).not.toContain("等待服务器确认");
    expect(shadow().querySelector("[data-retry]")).not.toBeNull();
  },
);

it("enables stop again when retrying a cancelled query in the same card", () => {
  const { ports } = stopWithPreview();
  ports[0]?.receive({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/analysis-error",
    requestId: "request-1",
    code: "cancelled",
  });
  click("[data-retry]");
  expect(ports).toHaveLength(2);
  expect(shadow().querySelector<HTMLButtonElement>("[data-stop]")?.hidden).toBe(false);
  expect(shadow().querySelector<HTMLButtonElement>("[data-stop]")?.disabled).toBe(false);
  click("[data-stop]");
  expect(ports[1]?.postMessage).toHaveBeenLastCalledWith({
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/analysis-cancel",
  });
});
