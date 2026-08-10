import type {
  ModelProvider,
  ProviderConfigurationStatus,
  SettingsPlatform,
  SettingsProviderStatus,
} from "@huayi/protocol";

const PROVIDERS: readonly ModelProvider[] = [
  "codex",
  "openai-responses",
  "openai-compatible-http",
  "deepseek-chat-completions",
];

export interface LocalConfigurationProbe {
  read(signal: AbortSignal): Promise<unknown>;
}

export interface ProviderSelectionStore {
  read(signal?: AbortSignal): Promise<ModelProvider>;
  write(
    provider: ModelProvider,
    dryRun: boolean,
  ): Promise<{ readonly dryRun: boolean; readonly provider: ModelProvider }>;
}

export interface SettingsConfigurationControllerOptions {
  codexProbe?: LocalConfigurationProbe;
  compatibleConfigurationProbe?: LocalConfigurationProbe;
  compatibleCredentialProbe?: LocalConfigurationProbe;
  deepSeekProbe: LocalConfigurationProbe;
  openAIProbe?: LocalConfigurationProbe;
  platform: SettingsPlatform;
  providerStore?: ProviderSelectionStore;
  wordbookProbe: LocalConfigurationProbe;
}

export interface LocalSettingsStatus {
  currentProvider: ModelProvider;
  platform: SettingsPlatform;
  providers: SettingsProviderStatus[];
  wordbookConfigured: boolean;
}

export class ProviderSelectionError extends Error {
  constructor() {
    super("Provider cannot be selected.");
    this.name = "ProviderSelectionError";
  }
}

async function probeStatus(
  probe: LocalConfigurationProbe | undefined,
  signal: AbortSignal,
): Promise<ProviderConfigurationStatus> {
  if (probe === undefined) return "unsupported";
  try {
    await probe.read(signal);
    signal.throwIfAborted();
    return "ready";
  } catch (error) {
    signal.throwIfAborted();
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "MODEL_PROVIDER_NOT_CONFIGURED" || error.code === "EUDIC_NOT_CONFIGURED")
    ) {
      return "not-configured";
    }
    throw error;
  }
}

export class SettingsConfigurationController {
  readonly #options: SettingsConfigurationControllerOptions;

  constructor(options: SettingsConfigurationControllerOptions) {
    if (options.platform === "macos" && options.providerStore === undefined) {
      throw new TypeError("macOS settings require a Provider store.");
    }
    this.#options = options;
  }

  async status(signal = new AbortController().signal): Promise<LocalSettingsStatus> {
    const [currentProvider, wordbookConfigured, ...statuses] = await Promise.all([
      this.#readCurrentProvider(signal),
      probeStatus(this.#options.wordbookProbe, signal).then((status) => status === "ready"),
      ...PROVIDERS.map((provider) => this.#providerStatus(provider, signal)),
    ]);
    return {
      currentProvider,
      platform: this.#options.platform,
      providers: PROVIDERS.map((provider, index) => ({
        provider,
        status: statuses[index] ?? "unsupported",
      })),
      wordbookConfigured,
    };
  }

  async selectProvider(
    provider: ModelProvider,
    signal = new AbortController().signal,
  ): Promise<ModelProvider> {
    if (this.#options.platform === "windows") {
      if (provider !== "deepseek-chat-completions") throw new ProviderSelectionError();
      if ((await this.#providerStatus(provider, signal)) !== "ready") {
        throw new ProviderSelectionError();
      }
      return provider;
    }
    if ((await this.#providerStatus(provider, signal)) !== "ready") {
      throw new ProviderSelectionError();
    }
    const store = this.#options.providerStore;
    if (store === undefined) throw new ProviderSelectionError();
    await store.write(provider, false);
    return provider;
  }

  async #readCurrentProvider(signal: AbortSignal): Promise<ModelProvider> {
    if (this.#options.platform === "windows") return "deepseek-chat-completions";
    const store = this.#options.providerStore;
    if (store === undefined) throw new ProviderSelectionError();
    return store.read(signal);
  }

  async #providerStatus(
    provider: ModelProvider,
    signal: AbortSignal,
  ): Promise<ProviderConfigurationStatus> {
    if (this.#options.platform === "windows" && provider !== "deepseek-chat-completions") {
      return "unsupported";
    }
    switch (provider) {
      case "codex":
        return probeStatus(this.#options.codexProbe, signal);
      case "openai-responses":
        return probeStatus(this.#options.openAIProbe, signal);
      case "deepseek-chat-completions":
        return probeStatus(this.#options.deepSeekProbe, signal);
      case "openai-compatible-http": {
        const [configuration, credential] = await Promise.all([
          probeStatus(this.#options.compatibleConfigurationProbe, signal),
          probeStatus(this.#options.compatibleCredentialProbe, signal),
        ]);
        return configuration === "ready" && credential === "ready"
          ? "ready"
          : configuration === "unsupported" || credential === "unsupported"
            ? "unsupported"
            : "not-configured";
      }
    }
  }
}
