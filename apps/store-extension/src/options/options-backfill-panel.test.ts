import { afterEach, expect, it, vi } from "vitest";

import { initializeOptionsBackfillPanel } from "./options-backfill-panel.js";
import { createHarness, element, renderPage } from "./options-page.test-support.js";

const backfillView = {
  status: {
    scopeId: "local",
    enabled: true,
    dailyHour: 8,
    revision: 1,
    pendingCount: 2,
    unresolvedCount: 0,
    unknownCount: 0,
    lastCheckedAt: null,
  },
  shared: false,
  needsLocalMerge: false,
  checkError: null,
  incomplete: false,
  lastCheckedAt: null,
};

function backfillButton(label: string): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-backfill-panel] button"),
  ].find((control) => control.textContent === label);
  if (!button) throw new Error(`Missing backfill button: ${label}`);
  return button;
}

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
});

it("mounts one styled backfill panel in external dictionaries before settings navigation starts", async () => {
  renderPage();
  const sendMessage = vi.fn().mockResolvedValue(backfillView);
  initializeOptionsBackfillPanel(document, { sendMessage });
  const panel = element("[data-backfill-panel]");
  expect(panel.closest("[data-options-backfill-mount].card")).not.toBeNull();
  expect(panel.closest('[data-settings-associated="wordbooks"]')).not.toBeNull();
  expect(panel.closest("[hidden]")).not.toBeNull();

  await createHarness().page.initialize();
  await vi.waitFor(() => expect(panel.textContent).toContain("待回填 2"));
  expect(backfillButton("需处理 (0)").disabled).toBe(true);
  for (const category of ["wordbooks", "common", "sites", "credentials", "lexicon", "wordbooks"]) {
    element<HTMLButtonElement>(`[data-settings-nav="${category}"]`).click();
    expect(panel.closest("[hidden]") === null).toBe(category === "wordbooks");
    expect(document.querySelectorAll("[data-backfill-panel]")).toHaveLength(1);
    expect(element("[data-backfill-panel]")).toBe(panel);
  }
  expect(sendMessage).toHaveBeenCalledOnce();
});

it("preserves busy backfill controls through another settings render", async () => {
  renderPage();
  const sendMessage = vi.fn().mockResolvedValue(backfillView);
  initializeOptionsBackfillPanel(document, { sendMessage });
  const { page } = createHarness();
  await page.initialize();
  await vi.waitFor(() => expect(backfillButton("检查新词").disabled).toBe(false));
  let finish: (value: unknown) => void = () => undefined;
  sendMessage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  element<HTMLButtonElement>('[data-settings-nav="wordbooks"]').click();
  backfillButton("检查新词").click();
  expect(backfillButton("检查新词").disabled).toBe(true);

  try {
    element<HTMLButtonElement>('[data-settings-nav="credentials"]').click();
    const provider = element<HTMLSelectElement>("[data-provider]");
    provider.value = "deepseek";
    provider.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.body.getAttribute("aria-busy")).toBe("false"));
    expect(backfillButton("检查新词").disabled).toBe(true);
    expect(backfillButton("需处理 (0)").disabled).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  } finally {
    finish(backfillView);
  }
  await vi.waitFor(() => expect(backfillButton("检查新词").disabled).toBe(false));
  expect(backfillButton("需处理 (0)").disabled).toBe(true);
});

it("does not fall back to a main element when the settings mount is absent", () => {
  document.body.innerHTML = "<main></main>";
  const sendMessage = vi.fn();
  expect(initializeOptionsBackfillPanel(document, { sendMessage })).toBeUndefined();
  expect(document.querySelector("[data-backfill-panel]")).toBeNull();
  expect(sendMessage).not.toHaveBeenCalled();
});
