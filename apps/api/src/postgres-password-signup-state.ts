import type { TransactionSql } from "postgres";

import { hashSecret } from "./security.js";
import { CloudFault } from "./cloud-fault.js";

export function createPostgresPasswordSignupState(
  options: { pepper: string },
  trusted: <T>(operation: (sql: TransactionSql) => Promise<T>) => Promise<T>,
) {
  return {
    async readPasswordSignupState(flowId: string) {
      const [row] = await trusted(
        (sql) => sql<{ state: string | null }[]>`
        SELECT read_password_signup_state(${hashSecret(flowId, options.pepper)}) AS state
      `,
      );
      if (row?.state == null)
        throw new CloudFault("authentication_required", "Registration is unavailable.");
      return row.state;
    },
    async comparePasswordSignupState(flowId: string, expected: string, next: string) {
      const [row] = await trusted(
        (sql) => sql<{ saved: boolean | null }[]>`
        SELECT compare_password_signup_state(${hashSecret(flowId, options.pepper)}, ${expected}, ${next}) AS saved
      `,
      );
      return row?.saved === true;
    },
  };
}
