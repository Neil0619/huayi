import type { ApiEnvironment } from "./environment.js";
import type { ExtensionRequestPolicy } from "./production-principal-authentication.js";

export function createProductionStorePolicy(environment: ApiEnvironment): ExtensionRequestPolicy {
  if (environment.HUAYI_STORE_EXTENSION_CAPABILITY === "disabled") {
    if (environment.HUAYI_STORE_EXTENSION_ID !== undefined) {
      throw new Error("Store capability configuration is invalid.");
    }
    return { capability: "disabled" };
  }
  if (environment.HUAYI_STORE_EXTENSION_ID === undefined) {
    throw new Error("Store capability configuration is invalid.");
  }
  return {
    capability: "enabled",
    extensionOrigin: `chrome-extension://${environment.HUAYI_STORE_EXTENSION_ID}`,
    minSupportedExtensionVersion: environment.HUAYI_MIN_SUPPORTED_EXTENSION_VERSION,
  };
}
