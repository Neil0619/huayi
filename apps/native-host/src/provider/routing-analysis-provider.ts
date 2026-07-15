import type { AnalysisResult, AnalyzeRequest, ModelProvider } from "@huayi/protocol";

import type { AnalysisProvider, AnalysisStreamListener } from "./analysis-provider.js";

export interface ProviderConfigurationReader {
  read(signal?: AbortSignal): Promise<ModelProvider>;
}

export interface RoutingAnalysisProviderOptions {
  codex: AnalysisProvider;
  compatibleHttp: AnalysisProvider;
  configurationStore: ProviderConfigurationReader;
  openAI: AnalysisProvider;
}

export class RoutingAnalysisProvider implements AnalysisProvider {
  readonly #codex: AnalysisProvider;
  readonly #compatibleHttp: AnalysisProvider;
  readonly #configurationStore: ProviderConfigurationReader;
  readonly #openAI: AnalysisProvider;
  #disposed = false;

  constructor(options: RoutingAnalysisProviderOptions) {
    this.#codex = options.codex;
    this.#compatibleHttp = options.compatibleHttp;
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
    switch (provider) {
      case "codex":
        return this.#codex.analyze(request, signal, onDelta);
      case "openai-responses":
        return this.#openAI.analyze(request, signal, onDelta);
      case "openai-compatible-http":
        return this.#compatibleHttp.analyze(request, signal, onDelta);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#codex.dispose?.();
    this.#compatibleHttp.dispose?.();
    this.#openAI.dispose?.();
  }
}
