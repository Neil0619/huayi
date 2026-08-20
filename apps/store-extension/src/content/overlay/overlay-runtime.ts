import type {
  StoreAnalysisClientMessage,
  StoreLexiconPresenceRequest,
  StoreLexiconSaveRequest,
  StoreStudyCaptureRequest,
} from "@huayi/store-domain";

interface PortListener<Listener> {
  addListener(listener: Listener): void;
}

export interface ContentAnalysisPort {
  readonly onDisconnect: PortListener<() => void>;
  readonly onMessage: PortListener<(message: unknown) => void>;
  disconnect(): void;
  postMessage(message: StoreAnalysisClientMessage): void;
}

export interface StoreOverlayRuntime {
  connectAnalysis(): ContentAnalysisPort;
  openOptions(): Promise<void>;
  openWebWorkspace(): Promise<void>;
  overlayStylesheetUrl(): string;
  queryWordPresence(request: StoreLexiconPresenceRequest): Promise<unknown>;
  saveWord(request: StoreLexiconSaveRequest): Promise<unknown>;
  studyCapture(request: StoreStudyCaptureRequest): Promise<unknown>;
}

export interface StoreOverlayAnchor {
  readonly bottom: number;
  readonly left: number;
  readonly top: number;
}

export type StoreOverlayCloseReason = "dismissed" | "owner-clear";
