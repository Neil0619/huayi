import { afterEach, expect, it, vi } from "vitest";
import { findBackfillTab } from "./backfill-tab.js";

afterEach(() => vi.unstubAllGlobals());
it("focus candidates need no tab URL access and require an affirmative top-frame response", async () => {
  const query = vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 3 }]);
  const sendMessage = vi.fn(async (id: number) => {
    if (id === 1) throw new Error("No receiver");
    return { shanbayCollection: id === 3 };
  });
  vi.stubGlobal("chrome", { tabs: { query, sendMessage } });
  expect(await findBackfillTab()).toEqual({ id: 3 });
  expect(query).toHaveBeenCalledWith({});
  for (const [id] of sendMessage.mock.calls)
    expect(sendMessage).toHaveBeenCalledWith(id, { type: "store/backfill-probe" }, { frameId: 0 });
});
