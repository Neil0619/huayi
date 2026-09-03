import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import { AccountSettingsNavigation } from "./account-settings-navigation.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("account settings navigation", () => {
  beforeEach(() => document.body.replaceChildren());

  it.each([
    ["account" as const, "账号与用量"],
    ["devices" as const, "扩展设备"],
    ["data" as const, "数据与账号"],
  ])("marks %s clearly and keeps the operator entry consistent", async (active, label) => {
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <AccountSettingsNavigation active={active} showOperatorNavigation />,
      ),
    );

    expect(container.querySelector("[aria-current='page']")?.textContent).toBe(label);
    expect(container.querySelector<HTMLAnchorElement>("a[href='/admin']")?.textContent).toBe(
      "运营控制台",
    );
  });
});
