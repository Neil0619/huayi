import type { SignInMethod } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import type { SignInMethodRecord } from "./account-sign-in-methods-app.js";

interface SignInMethodRow {
  linked_at: Date;
  method: SignInMethod;
}

export function createPostgresAccountSignInMethods(database: AnalysisDatabase) {
  return {
    read(ownerUserId: string): Promise<readonly SignInMethodRecord[]> {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        const rows = await tenant.rows<SignInMethodRow>(
          `SELECT method,linked_at FROM account_sign_in_methods
           ORDER BY CASE method WHEN 'password' THEN 0 ELSE 1 END`,
        );
        return rows.map((row) => ({ linkedAt: row.linked_at, method: row.method }));
      });
    },
  };
}
