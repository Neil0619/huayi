import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { HelpTip } from "./help-tip.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("opens useful help on focus, pins on click, and closes with Escape", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<HelpTip label="费用说明">使用自己的密钥不计入平台额度。</HelpTip>),
  );
  const button = host.querySelector("button");
  await act(async () => button?.focus());
  expect(document.querySelector("[role='tooltip']")?.textContent).toContain("不计入平台额度");
  await act(async () => button?.click());
  await act(async () => button?.blur());
  expect(button?.getAttribute("aria-expanded")).toBe("true");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(button?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => root.unmount());
  host.remove();
});
