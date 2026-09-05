import { beforeEach, expect, it } from "vitest";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { click, reading, setup, shadow } from "./store-overlay-controller.test-support.js";
beforeEach(() => {
  document.body.replaceChildren();
});
it("provides explicit stop and close controls while a query is running", () => {
  const { controller, ports } = setup();
  controller.show(reading("investigation", "word"), { bottom: 80, left: 40, top: 60 });
  click("[data-action='explain']");
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
  click("[data-close]");
  expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
});
