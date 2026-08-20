import type { ShanbayBatch } from "@huayi/store-domain";

import type { CloudWordbookApi } from "./cloud-wordbook-api.js";
import type { ExtensionSessionVault } from "./extension-session-vault.js";
import type { ExternalWordbookLeaseVault } from "./external-wordbook-lease-vault.js";

export function createCloudShanbayBridge(options: {
  allow(): Promise<boolean>;
  api: CloudWordbookApi;
  idempotencyKey(): string;
  randomId(): string;
  sessionVault: Pick<ExtensionSessionVault, "readSession">;
  vault: ExternalWordbookLeaseVault;
}) {
  const session = async () => {
    const value = await options.sessionVault.readSession();
    return value !== null && Date.parse(value.expiresAt) > Date.now() ? value : null;
  };
  return {
    async claimShanbayBatch(limit: number): Promise<ShanbayBatch | null> {
      if (!(await options.allow())) return null;
      const saved = await options.vault.read();
      if (saved !== null) {
        return {
          items: saved.entries
            .slice(0, limit)
            .map((entry) => ({ entryId: entry.headword, outboxId: entry.alias })),
          token: saved.batchToken,
        };
      }
      const current = await session();
      if (current === null) return null;
      const list = await options.api.list(
        { direction: "export", limit: 20, state: "pending", target: "shanbay" },
        current.token,
      );
      const job = list.items[0];
      if (job === undefined) return null;
      const lease = await options.api.lease(
        job.id,
        { claimNonce: options.randomId(), expectedRevision: job.revision },
        current.token,
      );
      if (lease.kind !== "export") return null;
      const state = {
        batchToken: options.randomId(),
        entries: lease.entries.slice(0, limit).map((entry) => ({
          alias: options.randomId(),
          headword: entry.headword,
          itemId: entry.itemId,
        })),
        expiresAt: lease.expiresAt,
        jobId: job.id,
        leaseToken: lease.leaseToken,
      };
      await options.vault.write(state);
      return {
        items: state.entries.map((entry) => ({ entryId: entry.headword, outboxId: entry.alias })),
        token: state.batchToken,
      };
    },
    async resolveShanbayBatch(
      batchToken: string,
      confirmedAliases: readonly string[],
      failedAliases: readonly string[],
    ): Promise<boolean> {
      const state = await options.vault.read();
      const current = await session();
      if (state === null || current === null || state.batchToken !== batchToken) return false;
      const confirmed = new Set(confirmedAliases);
      const failed = new Set(failedAliases);
      if (
        confirmed.size + failed.size !== state.entries.length ||
        state.entries.some((entry) => confirmed.has(entry.alias) === failed.has(entry.alias))
      ) {
        return false;
      }
      await options.api.submit(
        state.jobId,
        {
          kind: "export",
          leaseToken: state.leaseToken,
          receipts: state.entries.map((entry) =>
            confirmed.has(entry.alias)
              ? { itemId: entry.itemId, outcome: "confirmed" as const }
              : {
                  itemId: entry.itemId,
                  outcome: "failed" as const,
                  stableErrorCode: "invalid-response" as const,
                },
          ),
        },
        options.idempotencyKey(),
        current.token,
      );
      await options.vault.clear();
      return true;
    },
  };
}

export type CloudShanbayBridge = ReturnType<typeof createCloudShanbayBridge>;
