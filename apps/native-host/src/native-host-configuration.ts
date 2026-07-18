import { isAbsolute, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

interface BaseNativeHostConfiguration {
  environment: NodeJS.ProcessEnv;
  schemaDirectory: string;
  workingDirectory: string;
}

export type NativeHostConfiguration =
  | (BaseNativeHostConfiguration & {
      codexExecutable: string;
      compatibleHttpConfigurationPath: string;
      deepSeekCredentialHelperPath: null;
      deepSeekCredentialPath: null;
      eudicCredentialHelperPath: null;
      eudicCredentialPath: null;
      platformMode: "default";
      powershellExecutable: null;
      providerConfigurationPath: string;
    })
  | (BaseNativeHostConfiguration & {
      codexExecutable: null;
      compatibleHttpConfigurationPath: null;
      deepSeekCredentialHelperPath: string;
      deepSeekCredentialPath: string;
      eudicCredentialHelperPath: string;
      eudicCredentialPath: string;
      platformMode: "windows-deepseek";
      powershellExecutable: string;
      providerConfigurationPath: null;
    });

function requiredEnvironmentPath(
  environment: NodeJS.ProcessEnv,
  variableName: "HUAYI_CODEX_PATH" | "HUAYI_WORK_DIR",
): string {
  const value = environment[variableName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${variableName} is required.`);
  }
  if (!isAbsolute(value)) {
    throw new Error(`${variableName} must be an absolute path.`);
  }
  return value;
}

function requiredWindowsEnvironmentPath(
  environment: NodeJS.ProcessEnv,
  variableName: string,
): string {
  const value = environment[variableName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${variableName} is required.`);
  }
  if (!win32.isAbsolute(value)) throw new Error(`${variableName} must be an absolute path.`);
  return value;
}

export function readNativeHostConfiguration(
  environment: NodeJS.ProcessEnv,
  moduleUrl = import.meta.url,
): NativeHostConfiguration {
  const platformMode =
    environment.HUAYI_PLATFORM_MODE === "windows-deepseek" ? "windows-deepseek" : "default";
  if (
    environment.HUAYI_PLATFORM_MODE !== undefined &&
    environment.HUAYI_PLATFORM_MODE !== "windows-deepseek"
  ) {
    throw new Error("HUAYI_PLATFORM_MODE is invalid.");
  }
  const windowsMode = platformMode === "windows-deepseek";
  const codexExecutable = windowsMode
    ? null
    : requiredEnvironmentPath(environment, "HUAYI_CODEX_PATH");
  const workingDirectory = windowsMode
    ? requiredWindowsEnvironmentPath(environment, "HUAYI_WORK_DIR")
    : requiredEnvironmentPath(environment, "HUAYI_WORK_DIR");
  const defaultSchemaDirectory = resolve(
    fileURLToPath(new URL(".", moduleUrl)),
    "provider/schemas",
  );
  const schemaDirectory = environment.HUAYI_SCHEMA_DIR ?? defaultSchemaDirectory;
  if (!(windowsMode ? win32.isAbsolute(schemaDirectory) : isAbsolute(schemaDirectory))) {
    throw new Error("HUAYI_SCHEMA_DIR must be an absolute path.");
  }

  if (windowsMode) {
    return {
      codexExecutable: null,
      compatibleHttpConfigurationPath: null,
      deepSeekCredentialHelperPath: requiredWindowsEnvironmentPath(
        environment,
        "HUAYI_DEEPSEEK_CREDENTIAL_HELPER_PATH",
      ),
      deepSeekCredentialPath: requiredWindowsEnvironmentPath(
        environment,
        "HUAYI_DEEPSEEK_CREDENTIAL_PATH",
      ),
      eudicCredentialHelperPath: requiredWindowsEnvironmentPath(
        environment,
        "HUAYI_EUDIC_CREDENTIAL_HELPER_PATH",
      ),
      eudicCredentialPath: requiredWindowsEnvironmentPath(
        environment,
        "HUAYI_EUDIC_CREDENTIAL_PATH",
      ),
      environment,
      platformMode: "windows-deepseek",
      powershellExecutable: requiredWindowsEnvironmentPath(environment, "HUAYI_POWERSHELL_PATH"),
      providerConfigurationPath: null,
      schemaDirectory,
      workingDirectory,
    };
  }
  if (codexExecutable === null) throw new Error("HUAYI_CODEX_PATH is required.");
  return {
    codexExecutable,
    compatibleHttpConfigurationPath: posix.resolve(workingDirectory, "..", "compatible-http.json"),
    deepSeekCredentialHelperPath: null,
    deepSeekCredentialPath: null,
    eudicCredentialHelperPath: null,
    eudicCredentialPath: null,
    environment,
    platformMode: "default",
    powershellExecutable: null,
    providerConfigurationPath: posix.resolve(workingDirectory, "..", "provider.json"),
    schemaDirectory,
    workingDirectory,
  };
}
