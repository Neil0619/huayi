import type { ModelProvider } from "@huayi/protocol";

import type { OpenAIApiKeyReader } from "../credentials/openai-keychain.js";
import {
  createAnalysisProviderFactory,
  type AnalysisProviderFactoryOptions,
} from "../provider/analysis-provider-factory.js";
import type {
  OpenAIFetch,
  OpenAIFetchResponse,
  OpenAIModelConfiguration,
} from "../provider/openai-responses-client.js";
import type { CodexAppServer } from "../runtime/codex-app-server-lifecycle.js";
import type {
  ComparisonMilestoneRecorder,
  ComparisonProfileId,
  ComparisonProviderFactory,
} from "./compare-providers.js";

const RAW_DELTA_MARKER = "response.output_text.delta";
const MARKER_TAIL_LENGTH = RAW_DELTA_MARKER.length - 1;

type FactoryBuilder = typeof createAnalysisProviderFactory;

interface ComparisonProviderOptions {
  apiKeyReader: OpenAIApiKeyReader;
  appServer: CodexAppServer;
  createFactory?: FactoryBuilder;
  milestoneRouter?: ComparisonMilestoneRouter;
  openAIFetch: OpenAIFetch;
  schemaDirectory: string;
}

const inactiveMilestones: ComparisonMilestoneRecorder = {
  rawDelta: () => undefined,
  upstreamSent: () => undefined,
};

export interface ComparisonMilestoneRouter extends ComparisonMilestoneRecorder {
  activate(milestones: ComparisonMilestoneRecorder): void;
}

export function createComparisonMilestoneRouter(): ComparisonMilestoneRouter {
  let activeMilestones = inactiveMilestones;
  return {
    activate(milestones) {
      activeMilestones = milestones;
    },
    rawDelta() {
      activeMilestones.rawDelta();
    },
    upstreamSent() {
      activeMilestones.upstreamSent();
    },
  };
}

function fixedConfiguration(provider: ModelProvider) {
  return {
    async read() {
      return provider;
    },
  };
}

function instrumentAppServer(
  appServer: CodexAppServer,
  milestones: () => ComparisonMilestoneRecorder,
): CodexAppServer {
  return {
    dispose: () => appServer.dispose(),
    interrupt: (requestId) => appServer.interrupt(requestId),
    runTurn: (request) => {
      return appServer.runTurn({
        ...request,
        onAssistantDelta: (delta) => {
          milestones().rawDelta();
          request.onAssistantDelta(delta);
        },
      });
    },
    warmup: (signal) => appServer.warmup(signal),
  };
}

function instrumentResponseBody(
  response: OpenAIFetchResponse,
  milestones: () => ComparisonMilestoneRecorder,
): OpenAIFetchResponse {
  if (response.body === null) return response;
  const decoder = new TextDecoder();
  let tail = "";
  let recorded = false;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
      flush() {
        if (!recorded && (tail + decoder.decode()).includes(RAW_DELTA_MARKER)) {
          milestones().rawDelta();
        }
      },
      transform(chunk, controller) {
        if (!recorded) {
          const candidate = tail + decoder.decode(chunk, { stream: true });
          if (candidate.includes(RAW_DELTA_MARKER)) {
            recorded = true;
            milestones().rawDelta();
          }
          tail = candidate.slice(-MARKER_TAIL_LENGTH);
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return { body, headers: response.headers, status: response.status };
}

function instrumentFetch(
  openAIFetch: OpenAIFetch,
  milestones: () => ComparisonMilestoneRecorder,
): OpenAIFetch {
  return async (url, init) => {
    milestones().upstreamSent();
    return instrumentResponseBody(await openAIFetch(url, init), milestones);
  };
}

function createOneProvider(
  createFactory: FactoryBuilder,
  options: Omit<AnalysisProviderFactoryOptions, "configurationStore">,
  provider: ModelProvider,
  modelConfiguration?: Readonly<OpenAIModelConfiguration>,
) {
  return createFactory({
    ...options,
    configurationStore: fixedConfiguration(provider),
    ...(modelConfiguration === undefined ? {} : { openAIModelConfiguration: modelConfiguration }),
  }).analysisProvider;
}

export function createComparisonProviders(
  options: ComparisonProviderOptions,
): Record<ComparisonProfileId, ComparisonProviderFactory> {
  const createFactory = options.createFactory ?? createAnalysisProviderFactory;
  const milestoneRouter = options.milestoneRouter ?? createComparisonMilestoneRouter();
  const readMilestones = () => milestoneRouter;
  const sharedOptions = {
    apiKeyReader: options.apiKeyReader,
    appServer: instrumentAppServer(options.appServer, readMilestones),
    codexHealthCheck: async () => {
      throw new Error("Health checks are not part of Provider comparison.");
    },
    compatibleHttpApiKeyReader: {
      async read(): Promise<never> {
        throw new Error("Compatible credentials are not part of Provider comparison.");
      },
    },
    compatibleHttpConfigurationStore: {
      async read(): Promise<never> {
        throw new Error("Compatible configuration is not part of Provider comparison.");
      },
    },
    deepSeekApiKeyReader: {
      async read(): Promise<never> {
        throw new Error("DeepSeek credentials are not part of Provider comparison.");
      },
    },
    eudicAuthorizationReader: {
      async read(): Promise<never> {
        throw new Error("Wordbook credentials are not part of Provider comparison.");
      },
    },
    openAIFetch: instrumentFetch(options.openAIFetch, readMilestones),
    schemaDirectory: options.schemaDirectory,
  } satisfies Omit<AnalysisProviderFactoryOptions, "configurationStore">;
  const providers = {
    "codex-gpt-5.4-mini-low": createOneProvider(createFactory, sharedOptions, "codex"),
    "api-gpt-5.4-mini-low": createOneProvider(createFactory, sharedOptions, "openai-responses", {
      effort: "low",
      model: "gpt-5.4-mini",
    }),
    "api-gpt-5.6-luna-none": createOneProvider(createFactory, sharedOptions, "openai-responses", {
      effort: "none",
      model: "gpt-5.6-luna",
    }),
  };

  return Object.fromEntries(
    Object.entries(providers).map(([profile, provider]) => [
      profile,
      (milestones: ComparisonMilestoneRecorder) => {
        milestoneRouter.activate(milestones);
        return provider;
      },
    ]),
  ) as Record<ComparisonProfileId, ComparisonProviderFactory>;
}
