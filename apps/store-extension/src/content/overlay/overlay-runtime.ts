import type {
  StoreAnalysisClientMessage,
  StoreLexiconPresenceRequest,
  StoreLexiconSaveRequest,
  StoreStudyCaptureRequest,
} from "@huayi/store-domain";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

interface PortListener<Listener> {
  addListener(listener: Listener): void;
}

export interface ContentAnalysisPort {
  readonly onDisconnect: PortListener<() => void>;
  readonly onMessage: PortListener<(message: unknown) => void>;
  disconnect(): void;
  postMessage(message: StoreAnalysisClientMessage): void;
}

export function disconnectAnalysisPort(port: ContentAnalysisPort, cancel: boolean): void {
  if (cancel) {
    try {
      port.postMessage({ messageVersion: STORE_MESSAGE_VERSION, type: "store/analysis-cancel" });
    } catch {
      /* An already disconnected worker cannot receive cancellation. */
    }
  }
  try {
    port.disconnect();
  } catch {
    /* The port is already disconnected. */
  }
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

export function requestAnalysisStop(
  port: ContentAnalysisPort | null,
  body: HTMLElement | null,
): void {
  if (!port || !body) return;
  const message = body.ownerDocument.createElement("p");
  message.setAttribute("role", "status");
  message.textContent = "正在停止，请等待服务器确认；也可以关闭此卡片。";
  try {
    port.postMessage({ messageVersion: STORE_MESSAGE_VERSION, type: "store/analysis-cancel" });
  } catch {
    message.textContent = "停止请求尚未确认，请稍后重新打开查询。";
  }
  body.append(message);
  const stop = body.parentElement?.querySelector<HTMLButtonElement>("[data-stop]");
  if (stop) stop.disabled = true;
}

export function measureQueryPresentation(document: Document, receivedAt: number) {
  const view = document.defaultView;
  if (
    !view ||
    typeof view.requestAnimationFrame !== "function" ||
    typeof performance.measure !== "function"
  )
    return;
  view.requestAnimationFrame(() => {
    const name = "seen-said:query:increment-to-paint";
    if (performance.getEntriesByName(name).length >= 100) performance.clearMeasures(name);
    performance.measure(name, { start: receivedAt, end: performance.now() });
  });
}

export function showQueryDiagnostic(body: HTMLElement | null, diagnosticId?: string) {
  if (!body || !diagnosticId) return;
  const label = body.ownerDocument.createElement("small");
  label.textContent = `诊断编号：${diagnosticId}`;
  body.append(label);
}

export function restoreQueryFocus(previous: HTMLElement | null, restore: boolean) {
  if (restore && previous?.isConnected) previous.focus({ preventScroll: true });
}
