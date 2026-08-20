import type { AnalysisDatabase } from "./analysis-database.js";
import { createExtensionSessionDisconnectApp } from "./extension-session-disconnect-app.js";
import { createPostgresExtensionSessionDisconnect } from "./postgres-extension-session-disconnect.js";

export interface ProductionExtensionSessionDisconnectOptions {
  database: AnalysisDatabase;
  extensionOrigin: string;
  pepper: string;
}

export function createProductionExtensionSessionDisconnect(
  options: ProductionExtensionSessionDisconnectOptions,
) {
  return createExtensionSessionDisconnectApp({
    extensionOrigin: options.extensionOrigin,
    revoke: createPostgresExtensionSessionDisconnect(options),
  });
}
