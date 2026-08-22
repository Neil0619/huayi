import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HostedAcceptanceNotice } from "./hosted-acceptance-notice.js";

describe("hosted acceptance notice", () => {
  it("persistently identifies the hosted environment and traceable build", () => {
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const html = renderToStaticMarkup(<HostedAcceptanceNotice commit={commit} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Hosted 验收 · 0123456");
    expect(html).toContain(`data-deployment-commit="${commit}"`);
    expect(html).toContain("真实托管验收环境");
  });

  it("renders nothing without a validated hosted commit", () => {
    expect(renderToStaticMarkup(<HostedAcceptanceNotice />)).toBe("");
  });
});
