import { createPracticeTaskRecovery } from "./practice-task-recovery.js";
import { Hono } from "hono";
import { createPracticeWorkspace } from "./practice-workspace.js";
import { createPracticeWorkspaceApp } from "./practice-workspace-app.js";
import { authenticateLearningAccountRequest } from "./miniprogram-authentication.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import type { AnalysisModule } from "./analysis-module.js";
import type { DialoguePracticeModule } from "./dialogue-practice-module.js";
import type { ApiEnvironment } from "./environment.js";
import type { ExtensionQueryModule } from "./extension-query-module.js";
import type { LearningLibraryMaintenance } from "./learning-library-maintenance.js";
import { createLearningTaskApp } from "./learning-task-app.js";
import { createLearningTaskExecutor } from "./learning-task-executor.js";
import { createLearningTaskWorker } from "./learning-task-worker.js";
import { createPostgresLearningTasks } from "./postgres-learning-tasks.js";
import type { PracticeModule } from "./practice-module.js";
import { authenticateProductionContextRequest } from "./production-extension-authentication.js";
import type {
  ExtensionRequestPolicy,
  ProductionIdentityAuthentication,
} from "./production-principal-authentication.js";

export function createProductionLearningTasks(options: {
  database: AnalysisDatabase;
  environment: ApiEnvironment;
  identity: ProductionIdentityAuthentication;
  policy: ExtensionRequestPolicy;
  analysis: AnalysisModule;
  query: ExtensionQueryModule;
  practice: PracticeModule;
  dialogue: DialoguePracticeModule;
  maintenance: LearningLibraryMaintenance;
  purgeDiagnostics?: () => Promise<void>;
}) {
  const store = createPostgresLearningTasks(options.database);
  const worker = createLearningTaskWorker({
    recover: async () => {
      await options.purgeDiagnostics?.().catch(() => {
        console.error('{"level":"error","event":"diagnostics_cleanup_failed"}');
      });
      await createPracticeTaskRecovery(options.database)();
      await options.database.trusted((query) => query.rows("SELECT prune_miniprogram_auth()"));
    },
    store,
    execute: createLearningTaskExecutor(options),
  });
  const app = new Hono();
  app.route(
    "/",
    createPracticeWorkspaceApp({
      authenticate: (context) => authenticateLearningAccountRequest(options.identity, context),
      workspace: createPracticeWorkspace(options.database),
    }),
  );
  app.route(
    "/",
    createLearningTaskApp({
      authenticate: (context) =>
        authenticateProductionContextRequest(options.identity, context, options.policy),
      cronSecret: options.environment.CRON_SECRET,
      store,
      runWorker: () => worker.runOne(),
    }),
  );
  return app;
}
