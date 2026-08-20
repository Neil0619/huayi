import { describe, expect, it } from "vitest";

import { createSecretProtector } from "./secret-protection.js";
import { DeterministicSecrets } from "./test-support/security-fakes.js";

describe("server secret protection", () => {
  it("uses authenticated encryption and rejects altered ciphertext", () => {
    const protector = createSecretProtector({
      key: Buffer.alloc(32, 7),
      secrets: new DeterministicSecrets(),
    });
    const ciphertext = protector.protect("supabase-refresh-token");

    expect(ciphertext).not.toContain("supabase-refresh-token");
    expect(protector.unprotect(ciphertext)).toBe("supabase-refresh-token");
    const tampered = `${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}`;
    expect(() => protector.unprotect(tampered)).toThrow();
  });
});
