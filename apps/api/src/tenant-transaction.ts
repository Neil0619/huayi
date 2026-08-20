import { CloudFault } from "./cloud-fault.js";
import type { TenantTable } from "./tenant-tables.js";

type StoredRow = { id: string; ownerUserId: string } & Readonly<Record<string, unknown>>;

export interface TenantRepository {
  insert(table: TenantTable, id: string, value: Readonly<Record<string, unknown>>): void;
  list(table: TenantTable): readonly Readonly<Record<string, unknown>>[];
  update(table: TenantTable, id: string, value: Readonly<Record<string, unknown>>): void;
}

export function createTenantTransactionModule() {
  const tables = new Map<TenantTable, Map<string, StoredRow>>();

  async function run<Result>(
    ownerUserId: string,
    operation: (repository: TenantRepository) => Promise<Result> | Result,
  ): Promise<Result> {
    let active = true;
    function assertActive(): void {
      if (!active) throw new CloudFault("forbidden", "The tenant transaction has ended.");
    }
    const repository: TenantRepository = {
      insert(table, id, value) {
        assertActive();
        if ("ownerUserId" in value) {
          throw new CloudFault("invalid_request", "The owner is fixed by the session scope.");
        }
        const rows = tables.get(table) ?? new Map<string, StoredRow>();
        rows.set(id, { ...value, id, ownerUserId });
        tables.set(table, rows);
      },
      list(table) {
        assertActive();
        return [...(tables.get(table)?.values() ?? [])]
          .filter((row) => row.ownerUserId === ownerUserId)
          .map((row) => {
            const result: Record<string, unknown> = { ...row };
            delete result.ownerUserId;
            return Object.freeze(result);
          });
      },
      update(table, id, value) {
        assertActive();
        if ("ownerUserId" in value) {
          throw new CloudFault("invalid_request", "The owner is fixed by the session scope.");
        }
        const rows = tables.get(table);
        const row = rows?.get(id);
        if (row === undefined || row.ownerUserId !== ownerUserId) {
          throw new CloudFault("not_found", "The tenant resource was not found.");
        }
        rows?.set(id, { ...row, ...value, id, ownerUserId });
      },
    };
    try {
      return await operation(repository);
    } finally {
      active = false;
    }
  }

  return { run };
}
