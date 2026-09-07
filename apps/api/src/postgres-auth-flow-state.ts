import type { TransactionSql } from "postgres";

import { CloudFault } from "./cloud-fault.js";
import { hashSecret } from "./security.js";

export function createPostgresAuthFlowState(
  options: { pepper: string },
  trusted: <T>(operation: (sql: TransactionSql) => Promise<T>) => Promise<T>,
) {
  return {
    async readAuthFlowState(flowId: string) {
      const [result] = await trusted(
        (sql) => sql<{ state: string | null }[]>`
        SELECT read_auth_flow_state(${hashSecret(flowId, options.pepper)}) AS state
      `,
      );
      if (result?.state === null || result === undefined)
        throw new CloudFault("authentication_required", "The authentication flow is invalid.");
      return result.state;
    },
    async saveAuthFlowState(flowId: string, state: string) {
      const [result] = await trusted(
        (sql) => sql<{ saved: boolean | null }[]>`
        SELECT save_auth_flow_state(${hashSecret(flowId, options.pepper)}, ${state}) AS saved
      `,
      );
      if (result?.saved !== true)
        throw new CloudFault("authentication_required", "The authentication flow is invalid.");
    },
  };
}
