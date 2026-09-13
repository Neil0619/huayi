import { randomUUID } from "node:crypto";
import type { AnalysisDatabase } from "../analysis-database.js";
import { createPracticeTeachingFixture, practiceOwner } from "./practice-teaching-fixture.js";
import { createPostgresAnalysisQuota } from "../postgres-analysis-quota.js";
import { createPostgresPracticeGenerationRepository } from "../postgres-practice-generation.js";
import {
  createPaidPracticeGenerator,
  PracticeProviderError,
  type PracticeProvider,
} from "../paid-practice-generator.js";
import { createPracticeReference } from "../practice-reference.js";
import { createPostgresLearningTasks } from "../postgres-learning-tasks.js";
import { createLearningTaskExecutor } from "../learning-task-executor.js";
import { createLearningTaskWorker } from "../learning-task-worker.js";
import { createPracticeTaskRecovery } from "../practice-task-recovery.js";
import { createPracticeReferenceApp } from "../practice-reference-app.js";
import { createLearningTaskApp } from "../learning-task-app.js";
import type { PracticeSession } from "@huayi/cloud-contracts";

export const referenceResult = {
  sentence: "I need at least two days to finish the report.",
  translationZh: "我至少需要两天来完成报告。",
  usageNoteZh: "at least 说明最低时间要求。",
};
export const billedCalls = [
  { costMicroUsd: 10, usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 } },
];
export type Crash = "ready-return" | "apply-before" | "apply-return";
export const requestFor = (session: PracticeSession, ordinal = 0) => ({
  expectedRevision: session.revision,
  expectedControlRevision: session.workspace?.controlRevision ?? 0,
  ordinal,
});

export async function fixture(
  options: {
    crash?: Crash;
    quota?: number;
    killed?: boolean;
    output?: unknown;
    failProvider?: boolean;
    beforeProvider?: () => Promise<void>;
  } = {},
  existing?: Awaited<ReturnType<typeof createPracticeTeachingFixture>>,
) {
  const f = existing ?? (await createPracticeTeachingFixture());
  const priceId = randomUUID();
  await f.db.query(
    "INSERT INTO runtime_controls(name,enabled) VALUES('model_kill_switch',$1) ON CONFLICT(name) DO UPDATE SET enabled=$1",
    [options.killed ?? false],
  );
  await f.db.query(
    "INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from) VALUES($1,'deepseek','offline-independent-reference',100,100,100,now())",
    [priceId],
  );
  await f.db.query(
    "INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source) VALUES($1,$2,$2,(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '1 month',$3,'default')",
    [randomUUID(), practiceOwner, options.quota ?? 1000],
  );
  let injected = false;
  let armed = true;
  const fail = () => {
    injected = true;
    throw new Error("Independent injected response loss");
  };
  const applyDatabase: AnalysisDatabase = {
    ...f.database,
    async transaction(owner, operation) {
      let applying = false;
      const result = await f.database.transaction(owner, (queries) =>
        operation({
          ...queries,
          tenant: {
            async rows(text, parameters) {
              if (
                /UPDATE practice_generation_tasks SET state='applied',output=NULL,applied_output_hash/u.test(
                  text,
                )
              ) {
                applying = true;
                if (armed && options.crash === "apply-before" && !injected) fail();
              }
              return queries.tenant.rows(text, parameters);
            },
          },
        }),
      );
      if (applying && armed && options.crash === "apply-return" && !injected) fail();
      return result;
    },
  };
  const now = () => new Date();
  const quota = createPostgresAnalysisQuota({
    database: f.database,
    id: randomUUID,
    now,
    expiresAt: () => new Date(Date.now() + 180_000),
    priceVersionId: priceId,
  });
  const base = createPostgresPracticeGenerationRepository({
    database: f.database,
    ledgerId: randomUUID,
    now,
    priceVersionId: priceId,
    reservedMicroUsd: 100,
    quota,
  });
  const providerCommands: unknown[] = [];
  const provider: PracticeProvider = {
    async generate(command) {
      await options.beforeProvider?.();
      await command.beforeDispatch?.();
      providerCommands.push({
        kind: command.kind,
        input: command.input,
        hasPreview: Boolean(command.onPreview),
      });
      if (options.failProvider) throw new PracticeProviderError("model_unavailable", billedCalls);
      return {
        output: options.output ?? { kind: "sentence-reference", ...referenceResult },
        billedCalls,
      };
    },
  };
  const generator = createPaidPracticeGenerator({
    provider,
    repository: {
      ...base,
      async complete(command) {
        const result = await base.complete(command);
        if (armed && options.crash === "ready-return" && !injected) fail();
        return result;
      },
    },
  });
  const reference = createPracticeReference(applyDatabase, generator);
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected non-reference execution");
  };
  const execute = createLearningTaskExecutor({
    reference,
    practice: { startSentence: unused, submitAttempt: unused, retryFeedback: unused },
    analysis: { preparePlatformAnalysis: unused, prepareStudyCaptureAnalysis: unused },
    query: { prepare: unused },
    dialogue: { startDialogue: unused, submitTurn: unused, finish: unused, retryAssistant: unused },
    maintenance: { suggestions: unused },
  });
  const tasks = createPostgresLearningTasks(f.database);
  const recover = createPracticeTaskRecovery(f.database);
  const worker = createLearningTaskWorker({ store: tasks, execute, recover });
  const referenceApp = createPracticeReferenceApp({
    authenticate: async () => practiceOwner,
    reference,
  });
  const taskApp = createLearningTaskApp({
    authenticate: async () => ({ kind: "web", userId: practiceOwner }),
    cronSecret: "offline-only-worker-secret",
    store: tasks,
    runWorker: () => worker.runOne(),
  });
  return {
    ...f,
    reference,
    tasks,
    worker,
    recover,
    quota,
    referenceApp,
    taskApp,
    providerCommands,
    generationRepository: base,
    disarm: () => {
      armed = false;
    },
    reconcile: () => tasks.claim(), // claim executes actual internal reconcile under its security-definer boundary.
    async charges() {
      return {
        ledger: (
          await f.db.query(
            "SELECT id,request_id,feature,call_ordinal,cost_micro_usd,outcome FROM usage_ledger ORDER BY id",
          )
        ).rows,
        reservations: (
          await f.db.query(
            "SELECT id,request_id,status,reserved_micro_usd FROM quota_reservations ORDER BY id",
          )
        ).rows,
      };
    },
  };
}
