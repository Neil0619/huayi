import type { AnalysisEngine, DeviceVault } from "@huayi/store-domain";

import { createBrowserAnalysisEngine } from "./browser-analysis-engine.js";

export function createProductionAnalysisEngine(deviceVault: DeviceVault): AnalysisEngine {
  return createBrowserAnalysisEngine({ deviceVault });
}
