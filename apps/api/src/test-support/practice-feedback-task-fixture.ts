import { randomUUID } from "node:crypto";
import { formatPracticeTeachingFeedback } from "@huayi/cloud-contracts";
import { createPracticeTeachingFixture, practiceOwner } from "./practice-teaching-fixture.js";
import { createPostgresAnalysisQuota } from "../postgres-analysis-quota.js";
import { createPostgresPracticeGenerationRepository } from "../postgres-practice-generation.js";
import {
  createPaidPracticeGenerator,
  PracticeProviderError,
  type PracticeProvider,
} from "../paid-practice-generator.js";
import { createPracticeModule } from "../practice-module.js";
import { createPostgresLearningTasks } from "../postgres-learning-tasks.js";
import { createLearningTaskExecutor } from "../learning-task-executor.js";
import { createLearningTaskWorker } from "../learning-task-worker.js";
import { createPracticeTaskRecovery } from "../practice-task-recovery.js";

export const teachingFeedback = {
  assessment: "ready" as const,
  mainPointZh: "表达准确。",
  exampleSentence: "I need at least two days.",
  usageNoteZh: "至少表示数量下限。",
};
const output = {
  kind: "sentence-feedback" as const,
  teachingFeedback,
  feedback: formatPracticeTeachingFeedback(teachingFeedback),
};
export type FeedbackCrash = "ready-return" | "apply-before" | "apply-return";
export async function createFeedbackTaskFixture(crash: FeedbackCrash, retry: boolean) {
  const f = await createPracticeTeachingFixture();
  const priceId = randomUUID();
  // This isolated in-memory database can reach only the fake provider below.
  await f.db.query(
    "INSERT INTO runtime_controls(name,enabled) VALUES('model_kill_switch',false) ON CONFLICT(name) DO UPDATE SET enabled=false",
  );
  await f.db.query(
    "INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from) VALUES($1,'deepseek','offline-practice',100,100,100,now())",
    [priceId],
  );
  await f.db.query(
    "INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source) VALUES($1,$2,$2,date_trunc('month',now()),date_trunc('month',now())+interval '1 month',1000,'default')",
    [randomUUID(), practiceOwner],
  );
  const now = () => new Date();
  const base = createPostgresPracticeGenerationRepository({
    database: f.database,
    ledgerId: randomUUID,
    now,
    priceVersionId: priceId,
    reservedMicroUsd: 100,
    quota: createPostgresAnalysisQuota({
      database: f.database,
      id: randomUUID,
      now,
      expiresAt: () => new Date(Date.now() + 120_000),
      priceVersionId: priceId,
    }),
  });
  let calls = 0;
  let injected = false;
  const fail = () => {
    injected = true;
    throw new Error("Offline injected response loss");
  };
  const provider: PracticeProvider = {
    async generate(command) {
      await command.beforeDispatch?.();
      calls += 1;
      const billedCalls = [
        { costMicroUsd: 10, usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 } },
      ];
      if (retry && calls === 1) throw new PracticeProviderError("model_unavailable", billedCalls);
      return { billedCalls, output };
    },
  };
  const generator = createPaidPracticeGenerator({
    provider,
    repository: {
      ...base,
      async complete(command) {
        const saved = await base.complete(command);
        if (crash === "ready-return" && !injected) fail();
        return saved;
      },
    },
  });
  const practice = createPracticeModule({
    generator,
    id: randomUUID,
    now,
    repository: {
      ...f.repository,
      async completeFeedback(command) {
        if (crash === "apply-before" && !injected) fail();
        const saved = await f.repository.completeFeedback(command);
        if (crash === "apply-return" && !injected) fail();
        return saved;
      },
    },
  });
  const unused = async (): Promise<never> => {
    throw new Error("Unused offline dependency");
  };
  const execute = createLearningTaskExecutor({
    practice,
    analysis: { preparePlatformAnalysis: unused, prepareStudyCaptureAnalysis: unused },
    query: { prepare: unused },
    dialogue: { startDialogue: unused, submitTurn: unused, finish: unused, retryAssistant: unused },
    maintenance: { suggestions: unused },
  });
  const tasks = createPostgresLearningTasks(f.database);
  const recover = createPracticeTaskRecovery(f.database);
  const worker = createLearningTaskWorker({ store: tasks, execute, recover });
  return { ...f, tasks, worker, recover, providerCalls: () => calls };
}
