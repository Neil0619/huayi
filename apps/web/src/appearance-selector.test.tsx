import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppearanceSelector } from "./appearance-selector.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => document.body.replaceChildren());

async function renderSelector(value: "moon" | "silver" | "champagne" | "porcelain") {
  const onChange = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(<AppearanceSelector onChange={onChange} value={value} />),
  );
  return { container, onChange };
}

describe("AppearanceSelector", () => {
  it("offers four text-labelled radio choices with one selected state", async () => {
    const { container } = await renderSelector("silver");
    const radios = [...container.querySelectorAll<HTMLInputElement>("input[type='radio']")];

    expect(container.querySelector("legend")?.textContent).toBe("外观");
    expect(radios.map((radio) => radio.value)).toEqual([
      "moon",
      "silver",
      "champagne",
      "porcelain",
    ]);
    expect([...container.querySelectorAll("label")].map((label) => label.textContent)).toEqual([
      "去青月白",
      "流银镜白",
      "香槟晨霜",
      "霁蓝瓷光",
    ]);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(["silver"]);
  });

  it("moves and selects with arrow keys, wrapping at either end", async () => {
    const { container, onChange } = await renderSelector("porcelain");
    const porcelain = container.querySelector<HTMLInputElement>("input[value='porcelain']");

    porcelain?.focus();
    await act(async () =>
      porcelain?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })),
    );
    expect(onChange).toHaveBeenLastCalledWith("moon");
    expect(document.activeElement).toBe(
      container.querySelector<HTMLInputElement>("input[value='moon']"),
    );

    const moon = container.querySelector<HTMLInputElement>("input[value='moon']");
    await act(async () =>
      moon?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" })),
    );
    expect(onChange).toHaveBeenLastCalledWith("porcelain");
  });
});
