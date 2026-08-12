import { describe, expect, it } from "vitest";

import type { DeviceVault } from "@huayi/store-domain";

import { createDeviceDekSource } from "./device-dek-source.js";

function vault(getDek: DeviceVault["getDek"]): Pick<DeviceVault, "getDek"> {
  return { getDek };
}

describe("Device DEK source", () => {
  it("returns the always-available device key without lock state", async () => {
    const dek = crypto.getRandomValues(new Uint8Array(32));
    const source = createDeviceDekSource(vault(async () => dek));

    await expect(source.read()).resolves.toEqual(dek);
  });

  it("maps malformed encrypted storage to stable data corruption", async () => {
    const source = createDeviceDekSource(
      vault(async () => {
        throw Object.assign(new Error("private details"), { code: "invalid-persisted-data" });
      }),
    );

    await expect(source.read()).rejects.toMatchObject({ code: "data-corrupt" });
  });
});
