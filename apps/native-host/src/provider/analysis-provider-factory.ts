import type { ModelProvider } from "@huayi/protocol";

import type { CompatibleHttpConfiguration } from "../config/compatible-http-configuration.js";
import type { OpenAIApiKeyReader } from "../credentials/openai-keychain.js";
import type { CodexAppServer } from "../runtime/codex-app-server-lifecycle.js";
import type { CodexCapabilities } from "../runtime/codex-capabilities.js";
import { EudicClient, type EudicFetch } from "../wordbook/eudic-client.js";
import {
  EudicWordbookProvider,
  type EudicAuthorizationReader,
} from "../wordbook/eudic-wordbook-provider.js";
import type { WordbookProvider } from "../wordbook/wordbook-provider.js";
import type { AnalysisProvider } from "./analysis-provider.js";
import { CodexAppServerProvider } from "./codex-app-server-provider.js";
import { DeepSeekChatClient, type DeepSeekFetch } from "./deepseek-chat-client.js";
import { DeepSeekChatProvider, type DeepSeekCredentialReader } from "./deepseek-chat-provider.js";
import {
  CompatibleHttpResponsesClient,
  type CompatibleHttpFetch,
} from "./compatible-http-responses-client.js";
import {
  CompatibleHttpResponsesProvider,
  type CompatibleHttpConfigurationReader,
  type CompatibleHttpKeyReader,
} from "./compatible-http-responses-provider.js";
import { ModelSchemaRepository } from "./model-schema-repository.js";
import {
  OpenAIResponsesClient,
  type OpenAIFetch,
  type OpenAIModelConfiguration,
} from "./openai-responses-client.js";
import { OpenAIResponsesProvider } from "./openai-responses-provider.js";
import type { ProviderValidationDiagnosticSink } from "./provider-validation.js";
import {
  RoutingAnalysisProvider,
  type ProviderConfigurationReader,
} from "./routing-analysis-provider.js";

export type ActiveProviderHealth =
  | {
      codexVersion: string;
      model: "gpt-5.4-mini";
      provider: "codex";
    }
  | {
      codexVersion: null;
      model: "gpt-5.6-luna";
      provider: "openai-responses";
    }
  | {
      codexVersion: null;
      model: CompatibleHttpConfiguration["model"];
      provider: "openai-compatible-http";
    }
  | {
      codexVersion: null;
      model: "deepseek-v4-flash";
      provider: "deepseek-chat-completions";
    };

export interface AnalysisProviderFactoryOptions {
  apiKeyReader: OpenAIApiKeyReader;
  appServer: CodexAppServer;
  codexHealthCheck: () => Promise<CodexCapabilities>;
  compatibleHttpApiKeyReader: CompatibleHttpKeyReader;
  compatibleHttpConfigurationStore: CompatibleHttpConfigurationReader;
  compatibleHttpFetch?: CompatibleHttpFetch;
  configurationStore: ProviderConfigurationReader;
  deepSeekApiKeyReader: DeepSeekCredentialReader;
  deepSeekFetch?: DeepSeekFetch;
  eudicAuthorizationReader: EudicAuthorizationReader;
  eudicFetch?: EudicFetch;
  onValidationDiagnostic?: ProviderValidationDiagnosticSink;
  openAIFetch?: OpenAIFetch;
  openAIModelConfiguration?: Readonly<OpenAIModelConfiguration>;
  schemaDirectory: string;
}

export interface AnalysisProviderFactory {
  analysisProvider: AnalysisProvider;
  healthCheck(): Promise<ActiveProviderHealth>;
  wordbookProvider: WordbookProvider;
}

function createHealthCheck(
  configurationStore: ProviderConfigurationReader,
  compatibleHttpConfigurationStore: CompatibleHttpConfigurationReader,
  codexHealthCheck: () => Promise<CodexCapabilities>,
): () => Promise<ActiveProviderHealth> {
  return async () => {
    const provider: ModelProvider = await configurationStore.read();
    if (provider === "openai-compatible-http") {
      const configuration = await compatibleHttpConfigurationStore.read(
        new AbortController().signal,
      );
      return { codexVersion: null, model: configuration.model, provider };
    }
    if (provider === "deepseek-chat-completions") {
      return { codexVersion: null, model: "deepseek-v4-flash", provider };
    }
    if (provider === "openai-responses") {
      return {
        codexVersion: null,
        model: "gpt-5.6-luna",
        provider,
      };
    }
    const capabilities = await codexHealthCheck();
    return {
      codexVersion: capabilities.codexVersion,
      model: "gpt-5.4-mini",
      provider,
    };
  };
}

export function createAnalysisProviderFactory(
  options: AnalysisProviderFactoryOptions,
): AnalysisProviderFactory {
  const schemaRepository = new ModelSchemaRepository({
    schemaDirectory: options.schemaDirectory,
  });
  const codex = new CodexAppServerProvider({
    appServer: options.appServer,
    schemaRepository,
    ...(options.onValidationDiagnostic === undefined
      ? {}
      : { onValidationDiagnostic: options.onValidationDiagnostic }),
  });
  const openAIClient = new OpenAIResponsesClient(
    options.openAIFetch === undefined ? {} : { fetch: options.openAIFetch },
  );
  const openAI = new OpenAIResponsesProvider({
    apiKeyReader: options.apiKeyReader,
    client: openAIClient,
    ...(options.openAIModelConfiguration === undefined
      ? {}
      : { modelConfiguration: options.openAIModelConfiguration }),
    schemaRepository,
    ...(options.onValidationDiagnostic === undefined
      ? {}
      : { onValidationDiagnostic: options.onValidationDiagnostic }),
  });
  const compatibleHttpClient = new CompatibleHttpResponsesClient(
    options.compatibleHttpFetch === undefined ? {} : { fetch: options.compatibleHttpFetch },
  );
  const compatibleHttp = new CompatibleHttpResponsesProvider({
    apiKeyReader: options.compatibleHttpApiKeyReader,
    client: compatibleHttpClient,
    configurationStore: options.compatibleHttpConfigurationStore,
    schemaRepository,
    ...(options.onValidationDiagnostic === undefined
      ? {}
      : { onValidationDiagnostic: options.onValidationDiagnostic }),
  });
  const deepSeekClient = new DeepSeekChatClient(
    options.deepSeekFetch === undefined ? {} : { fetch: options.deepSeekFetch },
  );
  const deepSeek = new DeepSeekChatProvider({
    apiKeyReader: options.deepSeekApiKeyReader,
    client: deepSeekClient,
    schemaRepository,
    ...(options.onValidationDiagnostic === undefined
      ? {}
      : { onValidationDiagnostic: options.onValidationDiagnostic }),
  });
  const analysisProvider = new RoutingAnalysisProvider({
    codex,
    compatibleHttp,
    configurationStore: options.configurationStore,
    deepSeek,
    openAI,
  });
  const eudicClient = new EudicClient(
    options.eudicFetch === undefined ? {} : { fetch: options.eudicFetch },
  );
  const wordbookProvider = new EudicWordbookProvider({
    authorizationReader: options.eudicAuthorizationReader,
    client: eudicClient,
  });

  return {
    analysisProvider,
    healthCheck: createHealthCheck(
      options.configurationStore,
      options.compatibleHttpConfigurationStore,
      options.codexHealthCheck,
    ),
    wordbookProvider,
  };
}
