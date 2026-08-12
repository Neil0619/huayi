import type { DeviceVault } from "@huayi/store-domain";

import { createProductionDeviceVault } from "../vault/browser-device-vault.js";
import { LexiconError } from "./lexicon-error.js";

export interface DeviceDekSource {
  read(): Promise<Uint8Array>;
}

export function createDeviceDekSource(vault: Pick<DeviceVault, "getDek">): DeviceDekSource {
  return {
    async read() {
      try {
        return await vault.getDek();
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error.code === "invalid-persisted-data" || error.code === "authentication-failed")
        ) {
          throw new LexiconError("data-corrupt");
        }
        throw error;
      }
    },
  };
}

export function createProductionDeviceDekSource(): DeviceDekSource {
  return createDeviceDekSource(createProductionDeviceVault());
}
