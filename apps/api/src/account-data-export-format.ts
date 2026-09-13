import type { AccountDataExportFormatVersion } from "@huayi/cloud-contracts";
import { CloudFault } from "./cloud-fault.js";

/** Format is explicit in a request and pinned to the saved job, never inferred from Accept. */
export function accountDataExportQueryFormat(
  value: string | undefined,
): AccountDataExportFormatVersion {
  if (value === undefined || value === "1") return 1;
  if (value === "2") return 2;
  if (value === "3") return 3;
  throw new CloudFault("invalid_request", "Unsupported account export format.");
}
