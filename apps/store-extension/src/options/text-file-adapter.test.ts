import { describe, expect, it, vi } from "vitest";

import { createBrowserTextFileAdapter } from "./text-file-adapter.js";

describe("Browser text file adapter", () => {
  it("always revokes the download object URL after clicking the temporary anchor", async () => {
    const click = vi.fn();
    const anchor = document.createElement("a");
    anchor.click = click;
    const createElement = vi.spyOn(document, "createElement").mockReturnValueOnce(anchor);
    const createObjectURL = vi.fn(() => "blob:huayi-backup");
    const revokeObjectURL = vi.fn();
    const adapter = createBrowserTextFileAdapter({
      document,
      url: { createObjectURL, revokeObjectURL },
    });

    await adapter.downloadText("huayi-backup.json", "encrypted", "application/json");

    expect(createElement).toHaveBeenCalledWith("a");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:huayi-backup");
    expect(anchor.isConnected).toBe(false);
  });

  it("revokes the URL even when the synthetic anchor click throws", async () => {
    const anchor = document.createElement("a");
    anchor.click = vi.fn(() => {
      throw new Error("download rejected");
    });
    vi.spyOn(document, "createElement").mockReturnValueOnce(anchor);
    const revokeObjectURL = vi.fn();
    const adapter = createBrowserTextFileAdapter({
      document,
      url: { createObjectURL: () => "blob:failed", revokeObjectURL },
    });

    await expect(
      adapter.downloadText("huayi-backup.json", "encrypted", "application/json"),
    ).rejects.toThrow("download rejected");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:failed");
  });
});
