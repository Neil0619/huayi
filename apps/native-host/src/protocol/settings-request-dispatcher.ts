import { SCHEMA_VERSION, hostEventSchema } from "@huayi/protocol";
import type {
  AnalysisError,
  HostEvent,
  SettingsSelectProviderRequest,
  SettingsStatusRequest,
} from "@huayi/protocol";

import type { SettingsConfigurationController } from "../config/settings-configuration-controller.js";

type HostEventEmitter = (event: HostEvent) => void;

const SETTINGS_ERROR: AnalysisError = {
  code: "INTERNAL_ERROR",
  message: "本机服务处理失败，请重试。",
  retryable: true,
};

export class SettingsRequestDispatcher {
  constructor(private readonly controller?: SettingsConfigurationController) {}

  status(request: SettingsStatusRequest, emit: HostEventEmitter): void {
    if (this.controller === undefined) {
      this.emitError(emit, request.requestId);
      return;
    }
    void this.controller
      .status()
      .then((status) => {
        emit(
          hostEventSchema.parse({
            ...status,
            requestId: request.requestId,
            schemaVersion: SCHEMA_VERSION,
            type: "settings-status-result",
          }),
        );
      })
      .catch(() => this.emitError(emit, request.requestId));
  }

  selectProvider(request: SettingsSelectProviderRequest, emit: HostEventEmitter): void {
    if (this.controller === undefined) {
      this.emitError(emit, request.requestId);
      return;
    }
    void this.controller
      .selectProvider(request.provider)
      .then((provider) => {
        emit(
          hostEventSchema.parse({
            provider,
            requestId: request.requestId,
            schemaVersion: SCHEMA_VERSION,
            type: "settings-provider-selected",
          }),
        );
      })
      .catch(() => this.emitError(emit, request.requestId));
  }

  private emitError(emit: HostEventEmitter, requestId: string): void {
    emit(
      hostEventSchema.parse({
        error: SETTINGS_ERROR,
        requestId,
        schemaVersion: SCHEMA_VERSION,
        type: "error",
      }),
    );
  }
}
