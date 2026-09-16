import { afterEach, expect, it, vi } from "vitest";

vi.mock("./popup-page.js", () => ({
  PopupPage: class {
    initialize = vi.fn(async () => undefined);
  },
}));
vi.mock("../page-ui/cloud-session-updates.js", () => ({
  subscribeToCloudSession: () => () => undefined,
}));
vi.mock("../backfill/backfill-progress-updates.js", () => ({
  subscribeToBackfillProgress: () => () => undefined,
}));

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("does not mount or request the popup card with existing local settings but no UI opt-in", async () => {
  document.body.innerHTML = "<main></main>";
  const sendMessage = vi.fn(async () => undefined);
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: async () => ({ unrelatedSettings: true }) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage },
  });
  await import("./popup-entry.js");
  expect(document.querySelector("[data-backfill-panel]")).toBeNull();
  expect(sendMessage).not.toHaveBeenCalled();
});
