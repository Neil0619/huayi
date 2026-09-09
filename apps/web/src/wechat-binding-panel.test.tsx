import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WechatBindingPanel } from "./wechat-binding-panel.js";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("requires explicit confirmation and uses the fresh CSRF proof after password validation", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const approve = vi.fn(async () => undefined);
  const reauthenticate = vi.fn(async () => ({ csrfToken: "fresh" }));
  const changed = vi.fn();
  await act(async () =>
    root.render(
      <WechatBindingPanel
        email="friend@example.com"
        csrfToken="old"
        approve={approve}
        reauthenticate={reauthenticate}
        onCsrfTokenChanged={changed}
      />,
    ),
  );
  const change = async (id: string, value: string) =>
    act(async () => {
      const input = container.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) throw new Error("Missing input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await change("wechat-binding-code", "ABCD012345");
  await change("wechat-binding-password", "test-password");
  expect(container.querySelector<HTMLButtonElement>("[data-confirm-wechat]")?.disabled).toBe(true);
  await act(async () =>
    container.querySelector<HTMLInputElement>("#wechat-binding-confirm")?.click(),
  );
  await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
  expect(reauthenticate).toHaveBeenCalledWith("test-password", "old");
  expect(approve).toHaveBeenCalledWith("ABCD012345", "fresh");
  expect(changed).toHaveBeenCalledWith("fresh");
  expect(container.textContent).toContain("请返回小程序完成开通");
  await act(async () => root.unmount());
  container.remove();
});
