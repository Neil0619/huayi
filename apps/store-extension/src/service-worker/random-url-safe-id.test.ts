import { describe, expect, it, vi } from "vitest";

import { randomUrlSafeId } from "./random-url-safe-id.js";

describe("randomUrlSafeId", () => {
  it("encodes exactly 32 random bytes as unpadded base64url", () => {
    const getRandomValues = vi.fn(<T extends ArrayBufferView | null>(array: T): T => {
      if (!(array instanceof Uint8Array)) throw new TypeError("Expected bytes.");
      array.set(Array.from({ length: 32 }, (_, index) => index + 240));
      return array as T;
    });

    const value = randomUrlSafeId({ getRandomValues });

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(32);
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(value).not.toContain("=");
  });
});
