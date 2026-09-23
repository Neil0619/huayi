import { STORE_ANALYSIS_PORT_NAME } from "@huayi/store-domain";
import { createProductionQuerySession } from "./production-query-session.js";
import { rejectOutdatedAnalysisPort } from "./outdated-analysis-port.js";

export function installProductionQueryConnections(
  options: Parameters<typeof createProductionQuerySession>[1],
): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === STORE_ANALYSIS_PORT_NAME) createProductionQuerySession(port, options);
    else rejectOutdatedAnalysisPort(port);
  });
}
