import { resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";

import { hostEventSchema } from "@huayi/protocol";
import type { HostEvent } from "@huayi/protocol";

import { ProviderConfigurationStore } from "./config/provider-configuration-store.js";
import {
  EUDIC_SECURITY_EXECUTABLE,
  MacosEudicAuthorizationReader,
} from "./credentials/eudic-keychain.js";
import { OpenAIApiKeyReader } from "./credentials/openai-keychain.js";
import {
  readNativeHostConfiguration,
  type NativeHostConfiguration,
} from "./native-host-configuration.js";
import { NativeMessageDispatcher } from "./protocol/dispatcher.js";
import { NativeMessageDecoder, encodeNativeMessage } from "./protocol/framing.js";
import { createAnalysisProviderFactory } from "./provider/analysis-provider-factory.js";
import type { OpenAIFetch } from "./provider/openai-responses-client.js";
import {
  formatProviderValidationDiagnostic,
  type ProviderValidationDiagnosticSink,
} from "./provider/provider-validation.js";
import { CodexAppServerClient } from "./runtime/codex-app-server.js";
import { checkCodexCapabilities } from "./runtime/codex-capabilities.js";
import { discoverEnabledMcpServerNames } from "./runtime/codex-mcp-discovery.js";
import { NodeProcessRunner, type ProcessRunner } from "./runtime/codex-process.js";
import { mapAnalysisProviderError } from "./runtime/error-mapper.js";
import type { EudicFetch } from "./wordbook/eudic-client.js";
import { mapEudicError } from "./wordbook/eudic-errors.js";

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

export { readNativeHostConfiguration } from "./native-host-configuration.js";
export type { NativeHostConfiguration } from "./native-host-configuration.js";

export interface NativeHostDispatcherOptions extends Omit<
  NativeHostConfiguration,
  "providerConfigurationPath"
> {
  eudicFetch?: EudicFetch;
  errorOutput: Writable;
  openAIApiKeyReader?: OpenAIApiKeyReader;
  openAIFetch?: OpenAIFetch;
  processRunner: ProcessRunner;
  providerConfigurationPath?: string;
  securityExecutable?: string;
}

export function createProviderValidationDiagnosticSink(
  errorOutput: Writable,
): ProviderValidationDiagnosticSink {
  return (diagnostic) => {
    const line = formatProviderValidationDiagnostic(diagnostic);
    if (line !== undefined) errorOutput.write(line);
  };
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
    streams.input.removeListener("end", stop);
    streams.input.removeListener("close", stop);
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
  streams.input.once("end", stop);
  streams.input.once("close", stop);
  return stop;
}

export function createNativeHostDispatcher(
  options: NativeHostDispatcherOptions,
): NativeMessageDispatcher {
  const configurationStore = new ProviderConfigurationStore(
    options.providerConfigurationPath ?? resolve(options.workingDirectory, "..", "provider.json"),
  );
  const appServer = new CodexAppServerClient({
    codexExecutable: options.codexExecutable,
    environment: options.environment,
    mcpServerDiscovery: () =>
      discoverEnabledMcpServerNames({
        codexExecutable: options.codexExecutable,
        environment: options.environment,
        processRunner: options.processRunner,
        workingDirectory: options.workingDirectory,
      }),
    workingDirectory: options.workingDirectory,
  });
  const authorizationReader = new MacosEudicAuthorizationReader({
    environment: options.environment,
    processRunner: options.processRunner,
    securityExecutable: options.securityExecutable ?? EUDIC_SECURITY_EXECUTABLE,
    workingDirectory: options.workingDirectory,
  });
  const apiKeyReader =
    options.openAIApiKeyReader ??
    new OpenAIApiKeyReader({
      environment: options.environment,
      processRunner: options.processRunner,
      workingDirectory: options.workingDirectory,
    });
  const providers = createAnalysisProviderFactory({
    apiKeyReader,
    appServer,
    codexHealthCheck: () => checkCodexCapabilities(options),
    configurationStore,
    eudicAuthorizationReader: authorizationReader,
    onValidationDiagnostic: createProviderValidationDiagnosticSink(options.errorOutput),
    schemaDirectory: options.schemaDirectory,
    ...(options.eudicFetch === undefined ? {} : { eudicFetch: options.eudicFetch }),
    ...(options.openAIFetch === undefined ? {} : { openAIFetch: options.openAIFetch }),
  });
  return new NativeMessageDispatcher({
    healthCheck: providers.healthCheck,
    mapError: mapAnalysisProviderError,
    mapWordbookError: mapEudicError,
    maximumConcurrency: 2,
    provider: providers.analysisProvider,
    wordbookProvider: providers.wordbookProvider,
  });
}

export function startConfiguredNativeHost(environment = process.env): () => void {
  const processRunner = new NodeProcessRunner();
  const configuration = readNativeHostConfiguration(environment);
  return runNativeHost({
    dispatcher: createNativeHostDispatcher({
      ...configuration,
      errorOutput: process.stderr,
      processRunner,
    }),
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
