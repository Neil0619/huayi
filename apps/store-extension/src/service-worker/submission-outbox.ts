import type { CloudStudyCaptureFailureKind } from "./cloud-study-capture-api.js";
import type { ExtensionSessionVault } from "./extension-session-vault.js";
import {
  submissionOutboxInputSchema,
  type SubmissionOutboxInput,
  type SubmissionOutboxState,
  type SubmissionOutboxVault,
} from "./submission-outbox-vault.js";

export type { SubmissionOutboxState } from "./submission-outbox-vault.js";

export type SubmissionOutboxPublicStatus =
  | { readonly state: "empty" | "not-configured" | "session-unavailable" | "upload-disabled" }
  | {
      readonly count: number;
      readonly oldestQueuedAt: string;
      readonly state: "client-upgrade-required" | "not-configured" | "queued";
    };

const MAX_ITEMS = 20;
const MAX_BYTES = 5 * 1_024 * 1_024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

interface SubmissionOutboxOptions {
  readonly allowUpload: () => Promise<boolean>;
  readonly api: SubmissionOutboxApi | null;
  readonly clientVersion: string;
  readonly createIdempotencyKey: () => string;
  readonly now?: () => number;
  readonly sessionVault: Pick<ExtensionSessionVault, "clearSession" | "readSession">;
  readonly vault: SubmissionOutboxVault;
}

export interface SubmissionOutboxApi {
  submit(
    input: SubmissionOutboxInput,
    idempotencyKey: string,
    sessionToken: string,
  ): Promise<unknown>;
}

function retained(state: SubmissionOutboxState, now: number): SubmissionOutboxState {
  const items = state.items.filter((item) => now - Date.parse(item.createdAt) < RETENTION_MS);
  return items.length > 0 && state.clientUpgradeRequiredAtVersion !== undefined
    ? { clientUpgradeRequiredAtVersion: state.clientUpgradeRequiredAtVersion, items }
    : { items };
}

function unblocked(state: SubmissionOutboxState): SubmissionOutboxState {
  return { items: state.items };
}

function bytes(state: SubmissionOutboxState): number {
  return new TextEncoder().encode(JSON.stringify(state)).byteLength;
}

function failureKind(error: unknown): CloudStudyCaptureFailureKind | null {
  if (typeof error !== "object" || error === null || !("kind" in error)) return null;
  const kind = error.kind;
  return kind === "authentication" ||
    kind === "client-upgrade-required" ||
    kind === "permanent" ||
    kind === "transient"
    ? kind
    : null;
}

export function createSubmissionOutbox(options: SubmissionOutboxOptions) {
  const now = options.now ?? Date.now;
  let sequence = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = sequence.then(operation, operation);
    sequence = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const persist = async (state: SubmissionOutboxState) => {
    if (state.items.length === 0) await options.vault.clear();
    else await options.vault.write(state);
  };
  return {
    enqueue(input: SubmissionOutboxInput): Promise<{
      localQueueId?: string;
      status: "client-upgrade-required" | "local-only" | "queued";
    }> {
      return serial(async () => {
        if (!(await options.allowUpload())) {
          await options.vault.clear();
          return { status: "local-only" };
        }
        const session = await options.sessionVault.readSession();
        if (session === null || Date.parse(session.expiresAt) <= now()) {
          if (session !== null && Date.parse(session.expiresAt) <= now()) {
            await options.sessionVault.clearSession();
          }
          await options.vault.clear();
          return { status: "local-only" };
        }
        const stored = await options.vault.read();
        const state = retained(stored, now());
        if (options.api === null) {
          if (state.items.length !== stored.items.length) await persist(state);
          return { status: "local-only" };
        }
        const blocked = state.clientUpgradeRequiredAtVersion === options.clientVersion;
        const idempotencyKey = options.createIdempotencyKey();
        const next: SubmissionOutboxState = {
          ...(blocked
            ? { clientUpgradeRequiredAtVersion: state.clientUpgradeRequiredAtVersion }
            : {}),
          items: [
            ...state.items,
            {
              createdAt: new Date(now()).toISOString(),
              idempotencyKey,
              input: submissionOutboxInputSchema.parse(input),
            },
          ],
        };
        if (next.items.length > MAX_ITEMS || bytes(next) > MAX_BYTES) {
          await persist(state);
          return { status: "local-only" };
        }
        await options.vault.write(next);
        return {
          localQueueId: idempotencyKey,
          status: blocked ? "client-upgrade-required" : "queued",
        };
      });
    },
    remove(localQueueId: string): Promise<boolean> {
      return serial(async () => {
        const state = await options.vault.read();
        const remaining = state.items.filter((item) => item.idempotencyKey !== localQueueId);
        if (remaining.length === state.items.length) return false;
        await persist({
          ...(remaining.length > 0 && state.clientUpgradeRequiredAtVersion !== undefined
            ? { clientUpgradeRequiredAtVersion: state.clientUpgradeRequiredAtVersion }
            : {}),
          items: remaining,
        });
        return true;
      });
    },
    clear: () => serial(() => options.vault.clear()),
    process(): Promise<{
      pending: boolean;
      submission?: unknown;
      status:
        | "client-upgrade-required"
        | "discarded"
        | "idle"
        | "not-configured"
        | "retry"
        | "session-invalid"
        | "submitted";
      submittedId?: string;
    }> {
      return serial(async () => {
        if (!(await options.allowUpload())) {
          await options.vault.clear();
          return { pending: false, status: "discarded" };
        }
        const stored = await options.vault.read();
        const state = retained(stored, now());
        if (state.items.length !== stored.items.length) await persist(state);
        const item = state.items[0];
        if (item === undefined) {
          await options.vault.clear();
          return { pending: false, status: "idle" };
        }
        const session = await options.sessionVault.readSession();
        if (session === null || Date.parse(session.expiresAt) <= now()) {
          await Promise.all([options.sessionVault.clearSession(), options.vault.clear()]);
          return { pending: false, status: "session-invalid" };
        }
        if (options.api === null) {
          return { pending: false, status: "not-configured" };
        }
        if (state.clientUpgradeRequiredAtVersion === options.clientVersion) {
          return { pending: false, status: "client-upgrade-required" };
        }
        try {
          const submission = await options.api.submit(
            item.input,
            item.idempotencyKey,
            session.token,
          );
          const remaining = { items: state.items.slice(1) };
          await persist(remaining);
          return {
            pending: remaining.items.length > 0,
            status: "submitted" as const,
            submission,
            submittedId: item.idempotencyKey,
          };
        } catch (error) {
          const kind = failureKind(error);
          if (kind === "authentication") {
            await Promise.all([options.sessionVault.clearSession(), options.vault.clear()]);
            return { pending: false, status: "session-invalid" };
          }
          if (kind === "client-upgrade-required") {
            await persist({
              clientUpgradeRequiredAtVersion: options.clientVersion,
              items: state.items,
            });
            return { pending: false, status: "client-upgrade-required" };
          }
          if (kind !== "permanent") {
            if (state.clientUpgradeRequiredAtVersion !== undefined) await persist(unblocked(state));
            return { pending: true, status: "retry" };
          }
          const remaining = { items: state.items.slice(1) };
          await persist(remaining);
          return { pending: remaining.items.length > 0, status: "discarded" };
        }
      });
    },
    status(): Promise<SubmissionOutboxPublicStatus> {
      return serial(async () => {
        if (!(await options.allowUpload())) {
          await options.vault.clear();
          return { state: "upload-disabled" };
        }
        const session = await options.sessionVault.readSession();
        if (session === null || Date.parse(session.expiresAt) <= now()) {
          await Promise.all([options.sessionVault.clearSession(), options.vault.clear()]);
          return { state: "session-unavailable" };
        }
        const stored = await options.vault.read();
        const state = retained(stored, now());
        if (state.items.length !== stored.items.length) await persist(state);
        const first = state.items[0];
        if (first === undefined) {
          if (options.api === null) return { state: "not-configured" };
          await options.vault.clear();
          return { state: "empty" };
        }
        if (options.api === null) {
          return {
            count: state.items.length,
            oldestQueuedAt: first.createdAt,
            state: "not-configured",
          };
        }
        if (state.clientUpgradeRequiredAtVersion !== undefined) {
          if (state.clientUpgradeRequiredAtVersion === options.clientVersion) {
            return {
              count: state.items.length,
              oldestQueuedAt: first.createdAt,
              state: "client-upgrade-required",
            };
          }
          await persist(unblocked(state));
        }
        return {
          count: state.items.length,
          oldestQueuedAt: first.createdAt,
          state: "queued",
        };
      });
    },
  };
}

export type SubmissionOutbox = ReturnType<typeof createSubmissionOutbox>;
