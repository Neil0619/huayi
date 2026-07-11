import { isAbsolute, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostEventSchema } from "@huayi/protocol";
import type { HostEvent } from "@huayi/protocol";

import {
  EUDIC_SECURITY_EXECUTABLE,
  MacosEudicAuthorizationReader,
} from "./credentials/eudic-keychain.js";
import { NativeMessageDispatcher } from "./protocol/dispatcher.js";
import { NativeMessageDecoder, encodeNativeMessage } from "./protocol/framing.js";
import { CodexCliProvider } from "./provider/codex-cli-provider.js";
import { checkCodexCapabilities } from "./runtime/codex-capabilities.js";
import { NodeProcessRunner, type ProcessRunner } from "./runtime/codex-process.js";
import { mapCodexError } from "./runtime/error-mapper.js";
import { EudicClient, type EudicFetch } from "./wordbook/eudic-client.js";
import { mapEudicError } from "./wordbook/eudic-errors.js";
import { EudicWordbookProvider } from "./wordbook/eudic-wordbook-provider.js";

export interface RequestDispatcher {
  dispatch(message: unknown, emit: (event: HostEvent) => void): void;
  dispose?(): void;
}

export interface NativeHostStreams {
  dispatcher: RequestDispatcher;
  errorOutput: Writable;
  input: Readable;
  output: Writable;
}

export interface NativeHostConfiguration {
  codexExecutable: string;
  environment: NodeJS.ProcessEnv;
  schemaDirectory: string;
  workingDirectory: string;
}

export interface NativeHostDispatcherOptions extends NativeHostConfiguration {
  eudicFetch?: EudicFetch;
  processRunner: ProcessRunner;
  securityExecutable?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown protocol error.";
}

export function runNativeHost(streams: NativeHostStreams): () => void {
  const decoder = new NativeMessageDecoder();
  let stopped = false;

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    streams.input.removeListener("data", handleData);
    streams.dispatcher.dispose?.();
  };

  const fail = (error: unknown): void => {
    streams.errorOutput.write(`Native host protocol error: ${errorMessage(error)}\n`);
    stop();
  };

  const emit = (event: HostEvent): void => {
    if (stopped) {
      return;
    }
    try {
      const validatedEvent = hostEventSchema.parse(event);
      streams.output.write(encodeNativeMessage(validatedEvent));
    } catch (error) {
      fail(error);
    }
  };

  function handleData(chunk: Buffer | string): void {
    if (stopped) {
      return;
    }

    try {
      const messages = decoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      for (const message of messages) {
        if (stopped) {
          break;
        }
        streams.dispatcher.dispatch(message, emit);
      }
    } catch (error) {
      fail(error);
    }
  }

  streams.input.on("data", handleData);
  return stop;
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
    schemaDirectory,
    workingDirectory,
  };
}

export function createNativeHostDispatcher(
  options: NativeHostDispatcherOptions,
): NativeMessageDispatcher {
  const provider = new CodexCliProvider(options);
  const authorizationReader = new MacosEudicAuthorizationReader({
    environment: options.environment,
    processRunner: options.processRunner,
    securityExecutable: options.securityExecutable ?? EUDIC_SECURITY_EXECUTABLE,
    workingDirectory: options.workingDirectory,
  });
  const client = new EudicClient(
    options.eudicFetch === undefined ? {} : { fetch: options.eudicFetch },
  );
  const wordbookProvider = new EudicWordbookProvider({ authorizationReader, client });
  return new NativeMessageDispatcher({
    healthCheck: () => checkCodexCapabilities(options),
    mapError: mapCodexError,
    mapWordbookError: mapEudicError,
    maximumConcurrency: 2,
    provider,
    wordbookProvider,
  });
}

export function startConfiguredNativeHost(environment = process.env): () => void {
  const processRunner = new NodeProcessRunner();
  const configuration = readNativeHostConfiguration(environment);
  return runNativeHost({
    dispatcher: createNativeHostDispatcher({ ...configuration, processRunner }),
    errorOutput: process.stderr,
    input: process.stdin,
    output: process.stdout,
  });
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url;
}

if (isDirectExecution()) {
  try {
    startConfiguredNativeHost();
  } catch (error) {
    process.stderr.write(`Native host startup error: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
