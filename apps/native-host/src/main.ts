import { dirname, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";

import { hostEventSchema } from "@huayi/protocol";
import type { HostEvent } from "@huayi/protocol";

import { ProviderConfigurationStore } from "./config/provider-configuration-store.js";
import { CompatibleHttpConfigurationStore } from "./config/compatible-http-configuration-store.js";
import { CompatibleHttpApiKeyReader } from "./credentials/compatible-http-keychain.js";
import { DeepSeekApiKeyReader } from "./credentials/deepseek-keychain.js";
import { WindowsDeepSeekApiKeyReader } from "./credentials/windows-deepseek-credential.js";
import {
  EUDIC_SECURITY_EXECUTABLE,
  MacosEudicAuthorizationReader,
} from "./credentials/eudic-keychain.js";
import { OpenAIApiKeyReader } from "./credentials/openai-keychain.js";
import { readNativeHostConfiguration } from "./native-host-configuration.js";
import { NativeMessageDispatcher } from "./protocol/dispatcher.js";
import { NativeMessageDecoder, encodeNativeMessage } from "./protocol/framing.js";
import { createAnalysisProviderFactory } from "./provider/analysis-provider-factory.js";
import { DeepSeekChatClient } from "./provider/deepseek-chat-client.js";
import {
  DeepSeekChatProvider,
  type DeepSeekCredentialReader,
} from "./provider/deepseek-chat-provider.js";
import { ModelSchemaRepository } from "./provider/model-schema-repository.js";
import type { CompatibleHttpFetch } from "./provider/compatible-http-responses-client.js";
import type { DeepSeekFetch } from "./provider/deepseek-chat-client.js";
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

export interface NativeHostDispatcherOptions {
  codexExecutable?: string;
  compatibleHttpApiKeyReader?: CompatibleHttpApiKeyReader;
  compatibleHttpFetch?: CompatibleHttpFetch;
  deepSeekApiKeyReader?: DeepSeekCredentialReader;
  deepSeekFetch?: DeepSeekFetch;
  deepSeekCredentialHelperPath?: string;
  deepSeekCredentialPath?: string;
  eudicFetch?: EudicFetch;
  environment: NodeJS.ProcessEnv;
  errorOutput: Writable;
  openAIApiKeyReader?: OpenAIApiKeyReader;
  openAIFetch?: OpenAIFetch;
  platformMode?: "default" | "windows-deepseek";
  powershellExecutable?: string;
  processRunner: ProcessRunner;
  providerConfigurationPath?: string;
  securityExecutable?: string;
  schemaDirectory: string;
  workingDirectory: string;
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
  if (options.platformMode === "windows-deepseek") {
    const required = (value: string | undefined, name: string): string => {
      if (value === undefined) throw new Error(`${name} is required for Windows DeepSeek mode.`);
      return value;
    };
    const deepSeekApiKeyReader =
      options.deepSeekApiKeyReader ??
      new WindowsDeepSeekApiKeyReader({
        credentialHelperPath: required(
          options.deepSeekCredentialHelperPath,
          "deepSeekCredentialHelperPath",
        ),
        credentialPath: required(options.deepSeekCredentialPath, "deepSeekCredentialPath"),
        environment: options.environment,
        powershellExecutable: required(options.powershellExecutable, "powershellExecutable"),
        processRunner: options.processRunner,
        workingDirectory: options.workingDirectory,
      });
    const schemaRepository = new ModelSchemaRepository({
      schemaDirectory: options.schemaDirectory,
    });
    const client = new DeepSeekChatClient(
      options.deepSeekFetch === undefined ? {} : { fetch: options.deepSeekFetch },
    );
    const provider = new DeepSeekChatProvider({
      apiKeyReader: deepSeekApiKeyReader,
      client,
      onValidationDiagnostic: createProviderValidationDiagnosticSink(options.errorOutput),
      schemaRepository,
    });
    return new NativeMessageDispatcher({
      healthCheck: async () => ({
        codexVersion: null,
        model: "deepseek-v4-flash",
        provider: "deepseek-chat-completions",
      }),
      mapError: mapAnalysisProviderError,
      maximumConcurrency: 2,
      provider,
    });
  }

  const codexExecutable = options.codexExecutable;
  if (codexExecutable === undefined) throw new Error("codexExecutable is required.");
  const providerConfigurationPath =
    options.providerConfigurationPath ?? resolve(options.workingDirectory, "..", "provider.json");
  const configurationStore = new ProviderConfigurationStore(providerConfigurationPath);
  const compatibleHttpConfigurationStore = new CompatibleHttpConfigurationStore(
    resolve(dirname(providerConfigurationPath), "compatible-http.json"),
  );
  const appServer = new CodexAppServerClient({
    codexExecutable,
    environment: options.environment,
    mcpServerDiscovery: () =>
      discoverEnabledMcpServerNames({
        codexExecutable,
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
  const compatibleHttpApiKeyReader =
    options.compatibleHttpApiKeyReader ??
    new CompatibleHttpApiKeyReader({
      environment: options.environment,
      processRunner: options.processRunner,
      workingDirectory: options.workingDirectory,
    });
  const deepSeekApiKeyReader =
    options.deepSeekApiKeyReader ??
    new DeepSeekApiKeyReader({
      environment: options.environment,
      processRunner: options.processRunner,
      workingDirectory: options.workingDirectory,
    });
  const providers = createAnalysisProviderFactory({
    apiKeyReader,
    appServer,
    codexHealthCheck: () => checkCodexCapabilities({ ...options, codexExecutable }),
    compatibleHttpApiKeyReader,
    compatibleHttpConfigurationStore,
    configurationStore,
    deepSeekApiKeyReader,
    eudicAuthorizationReader: authorizationReader,
    onValidationDiagnostic: createProviderValidationDiagnosticSink(options.errorOutput),
    schemaDirectory: options.schemaDirectory,
    ...(options.eudicFetch === undefined ? {} : { eudicFetch: options.eudicFetch }),
    ...(options.compatibleHttpFetch === undefined
      ? {}
      : { compatibleHttpFetch: options.compatibleHttpFetch }),
    ...(options.openAIFetch === undefined ? {} : { openAIFetch: options.openAIFetch }),
    ...(options.deepSeekFetch === undefined ? {} : { deepSeekFetch: options.deepSeekFetch }),
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
  const dispatcherOptions: NativeHostDispatcherOptions =
    configuration.platformMode === "windows-deepseek"
      ? {
          deepSeekCredentialHelperPath: configuration.deepSeekCredentialHelperPath,
          deepSeekCredentialPath: configuration.deepSeekCredentialPath,
          environment: configuration.environment,
          errorOutput: process.stderr,
          platformMode: "windows-deepseek",
          powershellExecutable: configuration.powershellExecutable,
          processRunner,
          schemaDirectory: configuration.schemaDirectory,
          workingDirectory: configuration.workingDirectory,
        }
      : {
          codexExecutable: configuration.codexExecutable,
          environment: configuration.environment,
          errorOutput: process.stderr,
          processRunner,
          providerConfigurationPath: configuration.providerConfigurationPath,
          schemaDirectory: configuration.schemaDirectory,
          workingDirectory: configuration.workingDirectory,
        };
  return runNativeHost({
    dispatcher: createNativeHostDispatcher(dispatcherOptions),
    errorOutput: process.stderr,
    input: process.stdin,
    output: process.stdout,
  });
}
