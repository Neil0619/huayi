import type { AnalysisDatabase } from "./analysis-database.js";
import { createCloudWordCopyApp } from "./cloud-word-copy-app.js";
import { createCloudWordCopyModule } from "./cloud-word-copy-module.js";
import { createPostgresCloudWordCopy } from "./postgres-cloud-word-copy.js";
import { authenticateProductionExtensionRequest } from "./production-extension-authentication.js";
import type {
  ExtensionRequestPolicy,
  ProductionIdentityAuthentication,
} from "./production-principal-authentication.js";

export function createProductionCloudWordCopy(options: {
  database: AnalysisDatabase;
  identity: ProductionIdentityAuthentication;
  ids(): string;
  now(): Date;
  policy: ExtensionRequestPolicy;
}) {
  return createCloudWordCopyApp({
    authenticate: (context) =>
      authenticateProductionExtensionRequest(options.identity, context, options.policy),
    module: createCloudWordCopyModule({
      ids: options.ids,
      now: options.now,
      repository: createPostgresCloudWordCopy(options.database),
    }),
  });
}
