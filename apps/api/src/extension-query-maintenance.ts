import type { ExtensionQueryCleanupResponse } from "@huayi/cloud-contracts";

export interface ExtensionQueryMaintenance {
  runBatch(): Promise<ExtensionQueryCleanupResponse>;
}
