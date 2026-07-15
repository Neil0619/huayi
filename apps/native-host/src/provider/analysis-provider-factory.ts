import type { ModelProvider } from "@huayi/protocol";

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
    };

export interface AnalysisProviderFactoryOptions {
  apiKeyReader: OpenAIApiKeyReader;
  appServer: CodexAppServer;
  codexHealthCheck: () => Promise<CodexCapabilities>;
  configurationStore: ProviderConfigurationReader;
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
  codexHealthCheck: () => Promise<CodexCapabilities>,
): () => Promise<ActiveProviderHealth> {
  return async () => {
    const provider: ModelProvider = await configurationStore.read();
    if (provider === "openai-compatible-http") {
      throw new Error("Compatible HTTP provider is not available.");
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
  const analysisProvider = new RoutingAnalysisProvider({
    codex,
    configurationStore: options.configurationStore,
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
    healthCheck: createHealthCheck(options.configurationStore, options.codexHealthCheck),
    wordbookProvider,
  };
}
