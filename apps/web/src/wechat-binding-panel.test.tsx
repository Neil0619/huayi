import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { WechatBindingPanel } from "./wechat-binding-panel.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("explains direct mini-program login without asking a logged-in Web user for another proof", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<WechatBindingPanel email="friend@example.com" />));
    expect(container.textContent).toContain("登录并关联");
    expect(container.textContent).toContain("friend@example.com");
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain("关联验证密码");
  } finally {
    await act(async () => root.unmount());
  }
});
