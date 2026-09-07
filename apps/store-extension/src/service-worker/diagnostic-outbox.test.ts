import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createDiagnosticOutbox } from "./diagnostic-outbox.js";
const crypto = webcrypto as unknown as Crypto;
const event = {
  version: 1 as const,
  id: "71000000-0000-4000-8000-000000000001",
  occurredAt: "2026-09-07T00:00:00.000Z",
  source: "store" as const,
  severity: "error" as const,
  operation: "instant-query" as const,
  code: "provider-error" as const,
  stage: "http" as const,
};
function fixture() {
  let state: unknown;
  let consent: string | null = "71000000-0000-4000-8000-000000000003";
  let session = { token: "a".repeat(32), expiresAt: "2026-09-08T00:00:00.000Z" };
  let now = Date.parse(event.occurredAt);
  const upload = vi.fn<Parameters<typeof createDiagnosticOutbox>[0]["upload"]>(async () => 204);
  const schedule = vi.fn();
  const outbox = createDiagnosticOutbox({
    crypto,
    storage: {
      read: async () => state,
      write: async (value) => {
        state = value;
      },
      clear: async () => {
        state = undefined;
      },
    },
    consent: async () => consent,
    session: async () => session,
    now: () => now,
    upload,
    schedule,
  });
  return {
    outbox,
    upload,
    schedule,
    get state() {
      return state;
    },
    switchAccount: () => {
      session = { ...session, token: "b".repeat(32) };
    },
    withdraw: () => {
      consent = null;
    },
    advance: () => {
      now += 86_400_001;
    },
  };
}
describe("automatic diagnostic outbox", () => {
  it("does not restore a queue after consent is withdrawn during an upload", async () => {
    const f = fixture();
    const ticket = await f.outbox.begin();
    await f.outbox.record(event, ticket);
    let release: (status: number) => void = () => undefined;
    let started: () => void = () => undefined;
    const uploading = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.upload.mockImplementationOnce(async () => {
      started();
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    });
    const pending = f.outbox.flush();
    await uploading;
    f.withdraw();
    f.outbox.cancel();
    release(204);
    await pending;
    await f.outbox.flush();
    expect(f.state).toBeUndefined();
    expect(f.upload).toHaveBeenCalledTimes(1);
  });
  it("persists safe metadata, retries offline and deduplicates replay", async () => {
    const f = fixture();
    const ticket = await f.outbox.begin();
    await f.outbox.record(event, ticket);
    await f.outbox.record(event, ticket);
    f.upload.mockRejectedValueOnce(new Error("offline"));
    await f.outbox.flush();
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.state)).not.toContain("a".repeat(32));
    expect(f.schedule).toHaveBeenCalled();
    await f.outbox.flush(true);
    expect(f.upload.mock.calls[1]?.[0]).toEqual([event]);
    expect(f.state).toBeUndefined();
  });
  it("drops old-account, withdrawn and expired events without uploading", async () => {
    for (const action of ["switchAccount", "withdraw", "advance"] as const) {
      const f = fixture();
      const ticket = await f.outbox.begin();
      await f.outbox.record(event, ticket);
      f[action]();
      await f.outbox.flush();
      expect(f.upload).not.toHaveBeenCalled();
      expect(f.state).toBeUndefined();
    }
    const f = fixture();
    const ticket = await f.outbox.begin();
    f.switchAccount();
    await f.outbox.record(event, ticket);
    await f.outbox.flush();
    expect(f.upload).not.toHaveBeenCalled();
  });
  it("limits storage and stops retrying rejected credentials", async () => {
    const f = fixture();
    const ticket = await f.outbox.begin();
    for (let i = 0; i < 105; i++)
      await f.outbox.record({ ...event, id: crypto.randomUUID() }, ticket);
    expect((f.state as { items: unknown[] }).items).toHaveLength(100);
    f.upload.mockResolvedValue(401);
    await f.outbox.flush();
    expect(f.state).toBeUndefined();
  });
});
