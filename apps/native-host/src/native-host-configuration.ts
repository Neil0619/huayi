import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface NativeHostConfiguration {
  codexExecutable: string;
  environment: NodeJS.ProcessEnv;
  providerConfigurationPath: string;
  schemaDirectory: string;
  workingDirectory: string;
}

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

export function readNativeHostConfiguration(
  environment: NodeJS.ProcessEnv,
  moduleUrl = import.meta.url,
): NativeHostConfiguration {
  const codexExecutable = requiredEnvironmentPath(environment, "HUAYI_CODEX_PATH");
  const workingDirectory = requiredEnvironmentPath(environment, "HUAYI_WORK_DIR");
  const defaultSchemaDirectory = resolve(
    fileURLToPath(new URL(".", moduleUrl)),
    "provider/schemas",
  );
  const schemaDirectory = environment.HUAYI_SCHEMA_DIR ?? defaultSchemaDirectory;
  if (!isAbsolute(schemaDirectory)) {
    throw new Error("HUAYI_SCHEMA_DIR must be an absolute path.");
  }

  return {
    codexExecutable,
    environment,
    providerConfigurationPath: resolve(workingDirectory, "..", "provider.json"),
    schemaDirectory,
    workingDirectory,
  };
}
