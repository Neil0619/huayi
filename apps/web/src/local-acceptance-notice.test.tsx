import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocalAcceptanceNotice } from "./local-acceptance-notice.js";

describe("local acceptance notice", () => {
  it("persistently identifies simulated results and zero external cost", () => {
    const html = renderToStaticMarkup(<LocalAcceptanceNotice mode="simulated" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("本机验收 · 模拟模型");
    expect(html).toContain("不是 DeepSeek");
    expect(html).toContain("不产生外部费用");
  });

  it("renders nothing for a normal production build", () => {
    expect(renderToStaticMarkup(<LocalAcceptanceNotice />)).toBe("");
  });
});
