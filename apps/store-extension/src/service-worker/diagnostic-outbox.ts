import { diagnosticEventSchema, type DiagnosticEvent } from "@huayi/cloud-contracts";
import { z } from "zod/v3";

const itemSchema = z.strictObject({
  event: diagnosticEventSchema,
  sessionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  consentId: z.string().uuid(),
});
const stateSchema = z.strictObject({
  version: z.literal(1),
  items: z.array(itemSchema).max(100),
  attempt: z.number().int().min(0).max(10),
  nextAttemptAt: z.number().nonnegative(),
});
interface Ticket {
  sessionHash: string;
  consentId: string;
}
type State = z.infer<typeof stateSchema>;
const TTL = 86_400_000;

/** One serialized writer owns bounded metadata; credentials are read just in time and never stored here. */
export function createDiagnosticOutbox(options: {
  crypto: Crypto;
  storage: {
    read(): Promise<unknown>;
    write(state: unknown): Promise<void>;
    clear(): Promise<void>;
  };
  consent(): Promise<string | null>;
  session(): Promise<{ token: string; expiresAt: string } | null>;
  upload(events: DiagnosticEvent[], token: string, signal: AbortSignal): Promise<number>;
  schedule(when: number): void;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let writes = Promise.resolve();
  let revision = 0;
  let active: AbortController | undefined;
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = writes.then(run);
    writes = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const proof = async () => {
    const [consentId, session] = await Promise.all([options.consent(), options.session()]);
    if (!consentId || !session || Date.parse(session.expiresAt) <= now()) return null;
    const digest = await options.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(session.token),
    );
    const sessionHash = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    return { consentId, sessionHash, token: session.token };
  };
  const read = async (ticket: Ticket): Promise<State> => {
    const parsed = stateSchema.safeParse(await options.storage.read());
    const state: State = parsed.success
      ? parsed.data
      : { version: 1, items: [], attempt: 0, nextAttemptAt: 0 };
    return {
      ...state,
      items: state.items.filter(
        (item) =>
          item.sessionHash === ticket.sessionHash &&
          item.consentId === ticket.consentId &&
          Date.parse(item.event.occurredAt) > now() - TTL &&
          Date.parse(item.event.occurredAt) <= now() + 300_000,
      ),
    };
  };
  const save = async (state: State) => {
    while (
      state.items.length > 100 ||
      new TextEncoder().encode(JSON.stringify(state)).byteLength > 256 * 1024
    )
      state.items.shift();
    if (state.items.length) await options.storage.write(state);
    else await options.storage.clear();
  };
  return {
    async begin(): Promise<Ticket | null> {
      try {
        const current = await proof();
        return current ? { sessionHash: current.sessionHash, consentId: current.consentId } : null;
      } catch {
        return null;
      }
    },
    record(event: DiagnosticEvent, ticket: Ticket | null): Promise<void> {
      return serial(async () => {
        if (!ticket) return;
        const current = await proof();
        if (
          !current ||
          current.sessionHash !== ticket.sessionHash ||
          current.consentId !== ticket.consentId
        )
          return;
        const safe = diagnosticEventSchema.safeParse(event);
        if (!safe.success || safe.data.source !== "store") return;
        const state = await read(ticket);
        if (!state.items.some((item) => item.event.id === event.id))
          state.items.push({ ...ticket, event: safe.data });
        await save(state);
        options.schedule(Math.max(now() + 1000, state.nextAttemptAt));
      });
    },
    /** Abort immediately on consent/session changes, before queued storage reconciliation. */
    cancel(): void {
      revision += 1;
      active?.abort();
    },
    clear(): Promise<void> {
      revision += 1;
      active?.abort();
      return serial(() => options.storage.clear());
    },
    flush(force = false): Promise<void> {
      return serial(async () => {
        const version = revision;
        const current = await proof();
        if (!current) {
          await options.storage.clear();
          return;
        }
        const state = await read(current);
        if (!state.items.length) {
          await options.storage.clear();
          return;
        }
        if (!force && state.nextAttemptAt > now()) {
          await save(state);
          options.schedule(state.nextAttemptAt);
          return;
        }
        const batch = state.items.slice(0, 20);
        active = new AbortController();
        const timer = setTimeout(() => active?.abort(), 10_000);
        let status = 0;
        try {
          status = await options.upload(
            batch.map((item) => item.event),
            current.token,
            active.signal,
          );
        } catch {
          /* Retry bounded metadata only. */
        } finally {
          clearTimeout(timer);
          active = undefined;
        }
        if (version !== revision) return;
        const latest = await proof();
        if (
          !latest ||
          latest.sessionHash !== current.sessionHash ||
          latest.consentId !== current.consentId
        ) {
          await options.storage.clear();
          return;
        }
        if ([401, 403, 426].includes(status)) {
          await options.storage.clear();
          return;
        }
        if (status === 204 || status === 400 || status === 413) {
          state.items.splice(0, batch.length);
          state.attempt = 0;
          state.nextAttemptAt = now() + 1000;
        } else {
          state.attempt = Math.min(10, state.attempt + 1);
          state.nextAttemptAt = now() + Math.min(3_600_000, 60_000 * 2 ** (state.attempt - 1));
        }
        await save(state);
        if (state.items.length) options.schedule(state.nextAttemptAt);
      });
    },
  };
}
export type DiagnosticOutbox = ReturnType<typeof createDiagnosticOutbox>;
