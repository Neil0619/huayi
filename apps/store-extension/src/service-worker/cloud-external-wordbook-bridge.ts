import type { ExternalWordbookTarget, WordbookJobResource } from "@huayi/cloud-contracts";

import type { EudicWordbookClient } from "../wordbook/eudic-client.js";
import { eudicFailureCode } from "../wordbook/wordbook-errors.js";
import type { CloudWordbookApi } from "./cloud-wordbook-api.js";
import type { StoredExtensionSession } from "./extension-session-vault.js";

interface CloudExternalWordbookBridgeOptions {
  readonly allowTarget: (target: ExternalWordbookTarget) => Promise<boolean>;
  readonly api: CloudWordbookApi;
  readonly eudic: EudicWordbookClient;
  readonly idempotencyKey: () => string;
  readonly randomNonce: () => string;
  readonly session: () => Promise<StoredExtensionSession | null>;
}

function activeSession(value: StoredExtensionSession | null): value is StoredExtensionSession {
  return value !== null && Date.parse(value.expiresAt) > Date.now();
}

function stableEudicFailure(error: unknown) {
  const code = eudicFailureCode(error);
  return code === "vault-locked" ? ("data-corrupt" as const) : code;
}

export function createCloudExternalWordbookBridge(options: CloudExternalWordbookBridgeOptions) {
  const context = async (target?: ExternalWordbookTarget) => {
    const session = await options.session();
    if (!activeSession(session)) return null;
    if (target !== undefined && !(await options.allowTarget(target))) return null;
    return session;
  };
  return {
    async cancel(job: WordbookJobResource) {
      const session = await context(job.target);
      if (session === null) return null;
      return options.api.update(
        "cancel",
        job.id,
        { expectedRevision: job.revision },
        options.idempotencyKey(),
        session.token,
      );
    },
    async processOne(): Promise<boolean> {
      const session = await context();
      if (session === null) return false;
      const list = await options.api.list({ limit: 20 }, session.token);
      const job = list.items.find(
        (item) => item.target === "eudic" && (item.state === "pending" || item.state === "active"),
      );
      if (job === undefined || !(await options.allowTarget(job.target))) return false;
      const lease = await options.api.lease(
        job.id,
        { claimNonce: options.randomNonce(), expectedRevision: job.revision },
        session.token,
      );
      const signal = new AbortController().signal;
      if (lease.kind === "eudic-import") {
        try {
          const entries = await options.eudic.listWords(lease.page, signal);
          await options.api.submit(
            job.id,
            {
              entries: [...entries],
              kind: "eudic-import-page",
              leaseToken: lease.leaseToken,
              page: lease.page,
            },
            options.idempotencyKey(),
            session.token,
          );
        } catch (error) {
          await options.api.submit(
            job.id,
            {
              kind: "eudic-import-failure",
              leaseToken: lease.leaseToken,
              page: lease.page,
              stableErrorCode: stableEudicFailure(error),
            },
            options.idempotencyKey(),
            session.token,
          );
        }
        return true;
      }
      const receipts = [];
      for (const entry of lease.entries) {
        try {
          receipts.push({
            itemId: entry.itemId,
            outcome: await options.eudic.addWord(entry.headword, entry.contextLine, signal),
          } as const);
        } catch (error) {
          receipts.push({
            itemId: entry.itemId,
            outcome: "failed" as const,
            stableErrorCode: stableEudicFailure(error),
          });
        }
      }
      await options.api.submit(
        job.id,
        { kind: "export", leaseToken: lease.leaseToken, receipts },
        options.idempotencyKey(),
        session.token,
      );
      return true;
    },
    async retry(job: WordbookJobResource) {
      const session = await context(job.target);
      if (session === null) return null;
      return options.api.update(
        "retry",
        job.id,
        { expectedRevision: job.revision },
        options.idempotencyKey(),
        session.token,
      );
    },
    async start(target: ExternalWordbookTarget, direction: "import" | "export") {
      const session = await context(target);
      if (session === null) return null;
      return options.api.create({ direction, target }, options.idempotencyKey(), session.token);
    },
    async status() {
      const session = await context();
      if (session === null) return { items: [], nextCursor: null };
      return options.api.list({ limit: 20 }, session.token);
    },
  };
}

export type CloudExternalWordbookBridge = ReturnType<typeof createCloudExternalWordbookBridge>;
