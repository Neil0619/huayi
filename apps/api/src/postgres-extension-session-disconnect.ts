import type { AnalysisDatabase } from "./analysis-database.js";
import { hashSecret } from "./security.js";

export interface PostgresExtensionSessionDisconnectOptions {
  database: AnalysisDatabase;
  pepper: string;
}

export function createPostgresExtensionSessionDisconnect(
  options: PostgresExtensionSessionDisconnectOptions,
): (token: string) => Promise<void> {
  return async (token) => {
    await options.database.trusted((query) =>
      query.rows("SELECT revoke_current_extension_session($1)", [
        hashSecret(token, options.pepper),
      ]),
    );
  };
}
