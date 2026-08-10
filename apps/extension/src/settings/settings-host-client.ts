import {
  hostEventSchema,
  modelProviderSchema,
  type ModelProvider,
  type SettingsProviderSelectedEvent,
  type SettingsStatusResultEvent,
} from "@huayi/protocol";
import {
  parseStoredSettings,
  type ExtensionSettings,
  type SettingsMutation,
} from "./settings-domain.js";

interface SettingsRuntime {
  sendMessage(message: unknown): Promise<unknown>;
}

interface RuntimeResponse {
  error?: string;
  event?: unknown;
  handled: boolean;
}

function parseResponse(value: unknown): RuntimeResponse {
  if (typeof value !== "object" || value === null || !("handled" in value)) {
    throw new Error("扩展后台返回了无效配置结果。");
  }
  const response = value as Record<string, unknown>;
  if (response.handled !== true) {
    throw new Error(typeof response.error === "string" ? response.error : "本机配置请求失败。");
  }
  return { event: response.event, handled: true };
}

export class SettingsHostClient {
  constructor(
    private readonly runtime: SettingsRuntime = {
      sendMessage: (message) => chrome.runtime.sendMessage(message),
    },
  ) {}

  async status(): Promise<SettingsStatusResultEvent> {
    const response = parseResponse(await this.runtime.sendMessage({ type: "GET_HOST_SETTINGS" }));
    const parsed = hostEventSchema.safeParse(response.event);
    if (!parsed.success || parsed.data.type !== "settings-status-result") {
      throw new Error("本机服务返回了无效配置状态。");
    }
    return parsed.data;
  }

  async selectProvider(provider: ModelProvider): Promise<SettingsProviderSelectedEvent> {
    const validatedProvider = modelProviderSchema.parse(provider);
    const response = parseResponse(
      await this.runtime.sendMessage({
        provider: validatedProvider,
        type: "SELECT_HOST_PROVIDER",
      }),
    );
    const parsed = hostEventSchema.safeParse(response.event);
    if (!parsed.success || parsed.data.type !== "settings-provider-selected") {
      throw new Error("本机服务返回了无效 Provider 结果。");
    }
    return parsed.data;
  }

  async startWordSync(): Promise<void> {
    parseResponse(await this.runtime.sendMessage({ type: "START_WORD_SYNC" }));
  }

  async mutateSettings(mutation: SettingsMutation): Promise<ExtensionSettings> {
    const response = parseResponse(
      await this.runtime.sendMessage({ mutation, type: "MUTATE_SETTINGS" }),
    );
    const parsed = parseStoredSettings(response.event);
    if (parsed.status !== "valid") throw new Error("扩展后台返回了无效设置。");
    return parsed.settings;
  }
}
