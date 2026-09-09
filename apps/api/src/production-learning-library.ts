import { createWordCatalog } from "./word-catalog.js";
import { createLearningLibraryModule } from "./learning-library-module.js";
import { createLearningLibraryMaintenance } from "./learning-library-maintenance.js";
import { createPostgresLearningLibrary } from "./postgres-learning-library.js";
import { createPostgresLearningLibraryMaintenance } from "./postgres-learning-library-maintenance.js";
import { createPostgresWordLibrary } from "./postgres-word-library.js";
import { createPostgresExternalWordbook } from "./postgres-external-wordbook.js";
import { createExternalWordbookModule } from "./external-wordbook-module.js";
import { createWordLibraryModule } from "./word-library-module.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import type { ApiEnvironment } from "./environment.js";
import type { DeepSeekAnalysisFetch } from "./deepseek-analysis-protocol.js";
import type { DeepSeekPriceSchedule } from "./deepseek-price-schedule.js";
import { createProductionDuplicateSuggestions } from "./production-duplicate-suggestions.js";
import { systemClock } from "./security.js";
export function createProductionLearningLibrary(options: {
  database: AnalysisDatabase;
  environment: ApiEnvironment;
  fetch: DeepSeekAnalysisFetch;
  pricing: DeepSeekPriceSchedule;
}) {
  const { database: analysisDatabase, environment, fetch: providerFetch, pricing } = options;
  const library = createLearningLibraryModule({
    cursorKey: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    now: () => systemClock.now(),
    repository: createPostgresLearningLibrary(analysisDatabase),
  });
  const duplicateSuggestions = createProductionDuplicateSuggestions({
    apiKey: environment.HUAYI_DEEPSEEK_API_KEY,
    database: analysisDatabase,
    fetch: providerFetch,
    pricing,
  });
  const libraryMaintenance = createLearningLibraryMaintenance({
    duplicateSuggestions,
    now: () => systemClock.now(),
    repository: createPostgresLearningLibraryMaintenance(analysisDatabase),
  });
  const words = createWordLibraryModule({
    cursorKey: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    ids: () => crypto.randomUUID(),
    now: () => systemClock.now(),
    repository: createPostgresWordLibrary(analysisDatabase),
  });
  const externalWordbooks = createExternalWordbookModule({
    cursorKey: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    ids: () => crypto.randomUUID(),
    leaseDurationMs: 120_000,
    leaseKey: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
    now: () => systemClock.now(),
    repository: createPostgresExternalWordbook(analysisDatabase),
  });
  return {
    library,
    libraryMaintenance,
    words,
    externalWordbooks,
    wordCatalog: createWordCatalog({
      database: analysisDatabase,
      cursorKey: Buffer.from(environment.HUAYI_REFRESH_ENCRYPTION_KEY, "base64url"),
      now: systemClock.now,
    }),
  };
}
