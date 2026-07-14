import type { AnalysisResult, AnalyzeRequest, ModelProvider } from "@huayi/protocol";

import type { AnalysisProvider, AnalysisStreamListener } from "./analysis-provider.js";

export interface ProviderConfigurationReader {
  read(signal?: AbortSignal): Promise<ModelProvider>;
}

export interface RoutingAnalysisProviderOptions {
  codex: AnalysisProvider;
  configurationStore: ProviderConfigurationReader;
  openAI: AnalysisProvider;
}

export class RoutingAnalysisProvider implements AnalysisProvider {
  readonly #codex: AnalysisProvider;
  readonly #configurationStore: ProviderConfigurationReader;
  readonly #openAI: AnalysisProvider;
  #disposed = false;

  constructor(options: RoutingAnalysisProviderOptions) {
    this.#codex = options.codex;
    this.#configurationStore = options.configurationStore;
    this.#openAI = options.openAI;
  }

  async warmup(signal: AbortSignal): Promise<void> {
    const provider = await this.#configurationStore.read(signal);
    if (provider === "codex") {
      await this.#codex.warmup(signal);
    }
  }

  async analyze(
    request: AnalyzeRequest,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult> {
    const provider = await this.#configurationStore.read(signal);
    return provider === "codex"
      ? this.#codex.analyze(request, signal, onDelta)
      : this.#openAI.analyze(request, signal, onDelta);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#codex.dispose?.();
    this.#openAI.dispose?.();
  }
}
