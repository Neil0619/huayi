import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import { validateStructuredPayloadBudget } from "./structured-payload-budget.js";

describe("structured result wire budget", () => {
  it("accepts the exact serialized character boundary and rejects one character more", () => {
    const value = { t: "x".repeat(48 * 1024 - 8) };
    expect(JSON.stringify(value).length).toBe(48 * 1024);
    expect(() => validateStructuredPayloadBudget(value)).not.toThrow();
    expect(() => validateStructuredPayloadBudget({ t: `${value.t}x` })).toThrow(z.ZodError);
  });

  it("counts UTF-8 bytes independently from characters, including supplementary characters", () => {
    const value = { t: "中".repeat((128 * 1024 - 8) / 3) };
    expect(new TextEncoder().encode(JSON.stringify(value)).length).toBe(128 * 1024);
    expect(() => validateStructuredPayloadBudget(value)).not.toThrow();
    expect(() => validateStructuredPayloadBudget({ t: `${value.t}中` })).toThrow(z.ZodError);
    expect(() => validateStructuredPayloadBudget({ t: "😀".repeat(24000) })).not.toThrow();
  });

  it("budgets escaped JSON rather than the raw content and does not echo rejected content", () => {
    const value = { t: "private\n".repeat(6000) };
    expect(value.t.length).toBeLessThan(48 * 1024);
    expect(() => validateStructuredPayloadBudget(value)).toThrow(z.ZodError);
    try {
      validateStructuredPayloadBudget(value);
    } catch (error) {
      expect(String(error)).not.toContain("private");
    }
  });
});
