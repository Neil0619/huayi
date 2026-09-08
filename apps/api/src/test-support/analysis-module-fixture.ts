import { contractFixtures } from "@huayi/cloud-contracts";

import { createAnalysisModule } from "../analysis-module.js";
import { createInMemoryAnalysisRequestLifecycle } from "../analysis-request-lifecycle.js";
import {
  createInMemoryAnalysisCommitter,
  createInMemoryAnalysisRepository,
} from "../analysis-repository.js";
import { FakeAnalysisModel, FakeAnalysisQuota } from "./analysis-fakes.js";
import { createFakeStudyCaptureReader } from "./analysis-study-capture-fake.js";
import { MutableClock } from "./security-fakes.js";
import { createDeepSeekPriceSchedule } from "../deepseek-price-schedule.js";

export function analysisModuleFixture(
  content: unknown = {
    candidates: contractFixtures.analysis.candidates,
    modelMetadata: contractFixtures.analysis.modelMetadata,
    result: contractFixtures.analysis.result,
  },
  withDispatchPricing = false,
  failCommit = false,
  markDispatched: ReturnType<
    typeof createInMemoryAnalysisRequestLifecycle
  >["markDispatched"] = async () => undefined,
) {
  const model = new FakeAnalysisModel(content);
  const dispatchModel = new FakeAnalysisModel(content);
  const quota = new FakeAnalysisQuota();
  const repository = createInMemoryAnalysisRepository();
  const clock = new MutableClock("2026-08-12T10:00:00.000Z");
  const lifecycle = createInMemoryAnalysisRequestLifecycle({ now: () => clock.now() });
  const pricing = createDeepSeekPriceSchedule({
    legacy: "10000000-0000-4000-8000-000000000001",
    offPeak: "10000000-0000-4000-8000-000000000002",
    peak: "10000000-0000-4000-8000-000000000003",
  });
  const requestLifecycle = withDispatchPricing ? { ...lifecycle, markDispatched } : lifecycle;
  const baseCommitter = createInMemoryAnalysisCommitter(repository, quota, lifecycle);
  const module = createAnalysisModule({
    clock,
    committer: failCommit
      ? {
          ...baseCommitter,
          async complete() {
            throw new Error("database commit failed");
          },
        }
      : baseCommitter,
    cursorKey: new Uint8Array(32).fill(7),
    ids: (() => {
      let value = 0;
      return () => `generated-${++value}`;
    })(),
    model,
    ...(withDispatchPricing ? { modelForPricing: () => dispatchModel, pricing } : {}),
    quota,
    requestLifecycle,
    repository,
    studyCaptures: createFakeStudyCaptureReader(),
  });
  return {
    clock,
    dispatchModel,
    lifecycle,
    markDispatched,
    model,
    module,
    pricing,
    quota,
    repository,
  };
}
