import { dirname, join } from "node:path";

import { startConfiguredNativeHost } from "./main.js";

function runWindowsHost(): void {
  if (process.platform !== "win32") throw new Error("Windows Host executable requires Windows.");
  const applicationDirectory = dirname(process.execPath);
  const systemRoot = process.env.SystemRoot;
  if (systemRoot === undefined || systemRoot.trim().length === 0) {
    throw new Error("Windows SystemRoot is unavailable.");
  }
  startConfiguredNativeHost({
    ...process.env,
    HUAYI_DEEPSEEK_CREDENTIAL_HELPER_PATH: join(applicationDirectory, "deepseek-credential.ps1"),
    HUAYI_DEEPSEEK_CREDENTIAL_PATH: join(applicationDirectory, "deepseek-credential.xml"),
    HUAYI_EUDIC_CREDENTIAL_HELPER_PATH: join(applicationDirectory, "eudic-credential.ps1"),
    HUAYI_EUDIC_CREDENTIAL_PATH: join(applicationDirectory, "eudic-credential.xml"),
    HUAYI_PLATFORM_MODE: "windows-deepseek",
    HUAYI_POWERSHELL_PATH: join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    HUAYI_SCHEMA_DIR: join(applicationDirectory, "provider", "schemas"),
    HUAYI_WORK_DIR: join(applicationDirectory, "workdir"),
  });
}

try {
  runWindowsHost();
} catch {
  process.stderr.write("Huayi Windows Native Host startup failed.\n");
  process.exitCode = 1;
}
