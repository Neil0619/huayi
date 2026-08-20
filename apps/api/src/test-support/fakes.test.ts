import { describe, expect, it } from "vitest";

import { FakeClock, FakeMail, FakeModel, TemporaryDatabase } from "./fakes.js";

describe("Cloud test foundations", () => {
  it("are deterministic and offline", () => {
    expect(new FakeClock().now().toISOString()).toBe("2026-08-12T00:00:00.000Z");
    expect(new FakeModel().requests).toEqual([]);
    expect(new FakeMail().deliveries).toEqual([]);
    expect(new TemporaryDatabase().kind).toBe("temporary");
  });
});
