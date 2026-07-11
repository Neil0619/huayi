import { isAbsolute } from "node:path";

export const NATIVE_HOST_NAME = "com.huayi.codex_bridge";

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
const NATIVE_HOST_DESCRIPTION = "Huayi Codex Native Messaging bridge";

export interface NativeHostManifest {
  readonly allowed_origins: readonly [string];
  readonly description: string;
  readonly name: typeof NATIVE_HOST_NAME;
  readonly path: string;
  readonly type: "stdio";
}

export function validateExtensionId(extensionId: string): void {
  if (!EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new TypeError("Chrome extension ID must contain exactly 32 lowercase characters a-p.");
  }
}

export function createNativeHostManifest(
  extensionId: string,
  launcherPath: string,
): NativeHostManifest {
  validateExtensionId(extensionId);
  if (!isAbsolute(launcherPath)) {
    throw new TypeError("Native host launcher path must be absolute.");
  }

  return {
    allowed_origins: [`chrome-extension://${extensionId}/`],
    description: NATIVE_HOST_DESCRIPTION,
    name: NATIVE_HOST_NAME,
    path: launcherPath,
    type: "stdio",
  };
}
