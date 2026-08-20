import { describe, expect, it } from "vitest";

import { CloudFault } from "./cloud-fault.js";
import { tenantTables } from "./tenant-tables.js";
import { createTenantTransactionModule } from "./tenant-transaction.js";

describe("tenant transaction seam", () => {
  it.each(tenantTables)(
    "fixes owner scope for %s without accepting a caller owner",
    async (table) => {
      const module = createTenantTransactionModule();
      await module.run("user-a", async (repository) => {
        repository.insert(table, "row-a", { value: "owned by A" });
      });
      await module.run("user-b", async (repository) => {
        repository.insert(table, "row-b", { value: "owned by B" });
        expect(repository.list(table)).toEqual([{ id: "row-b", value: "owned by B" }]);
        expect(() => repository.update(table, "row-a", { value: "stolen" })).toThrowError(
          expect.objectContaining({ code: "not_found" }),
        );
      });
      await module.run("user-a", async (repository) => {
        expect(repository.list(table)).toEqual([{ id: "row-a", value: "owned by A" }]);
      });
    },
  );

  it("rejects ownerUserId in client values", async () => {
    const module = createTenantTransactionModule();
    await expect(
      module.run("user-a", async (repository) => {
        repository.insert("analysis_records", "row-a", { ownerUserId: "user-b" });
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("does not expose an owner setter or permit repository use outside a transaction", async () => {
    const module = createTenantTransactionModule();
    let escapedRepository:
      { list(table: "analysis_records"): readonly Readonly<Record<string, unknown>>[] } | undefined;
    await module.run("user-a", async (repository) => {
      escapedRepository = repository;
      expect("setOwner" in repository).toBe(false);
    });

    expect(() => escapedRepository?.list("analysis_records")).toThrow(CloudFault);
  });
});
