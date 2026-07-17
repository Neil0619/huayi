import {
  HUAYI_BASE_INSTRUCTIONS,
  HUAYI_DEVELOPER_INSTRUCTIONS,
  HUAYI_THREAD_CONFIG,
} from "./codex-app-server-config.js";
import type { JsonRpcChannel, JsonRpcNotification } from "./json-rpc-channel.js";

export interface ThreadStartResponse {
  approvalPolicy: "never";
  cwd: string;
  instructionSources: string[];
  model: string;
  modelProvider: string;
  reasoningEffort: string | null;
  sandbox: unknown;
  thread: { ephemeral: boolean; id: string };
}

export interface TurnStartResponse {
  turn: { id: string; status: string };
}

export class AppServerInvariantError extends Error {
  constructor() {
    super("Codex App Server invariant mismatch.");
    this.name = "AppServerInvariantError";
  }
}

interface RoutedEvent {
  threadId: string;
  turnId: string;
}

export interface AgentDeltaEvent extends RoutedEvent {
  delta: string;
  itemId: string;
  kind: "agentDelta";
}

export interface ItemEvent extends RoutedEvent {
  item: { id: string; text?: unknown; type: string };
  kind: "item";
  lifecycle: "completed" | "started";
}

export interface TurnCompletedEvent extends RoutedEvent {
  error?: unknown;
  kind: "turnCompleted";
  status: string;
}

export type AppServerEvent = AgentDeltaEvent | ItemEvent | TurnCompletedEvent;
export type ParsedNotification =
  AppServerEvent | { kind: "ignore" } | { kind: "invalid" } | { kind: "unsafe" };

export interface TurnDeferred {
  promise: Promise<string>;
  reject(reason: Error): void;
  resolve(text: string): void;
}

export const SAFE_APP_SERVER_ITEM_TYPES = new Set(["agentMessage", "reasoning", "userMessage"]);

export function createTurnDeferred(): TurnDeferred {
  let resolve: TurnDeferred["resolve"] = () => {
    throw new Error("Deferred promise was not initialized.");
  };
  let reject: TurnDeferred["reject"] = () => {
    throw new Error("Deferred promise was not initialized.");
  };
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasExactKeys(value: JsonObject, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && keys.every((key) => expectedKeys.includes(key));
}

function isEmptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return isObject(value) && Object.keys(value).length === 0;
}

function isUnsafeMethod(method: string): boolean {
  return (
    /configWarning|approval|elicitation|requestUserInput|hook/i.test(method) ||
    /^app\//u.test(method) ||
    /^mcpServer\//u.test(method) ||
    /^item\/(?:commandExecution|fileChange|mcpToolCall|dynamicToolCall|collabToolCall|webSearch|image)/u.test(
      method,
    )
  );
}

export function isInitializeResponse(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonEmptyString(value.platformFamily) &&
    isNonEmptyString(value.platformOs) &&
    isNonEmptyString(value.userAgent)
  );
}

export function isSafeHooksResponse(value: unknown, workingDirectory: string): boolean {
  return (
    isObject(value) &&
    hasExactKeys(value, ["data"]) &&
    Array.isArray(value.data) &&
    value.data.every(
      (record) =>
        isObject(record) &&
        hasExactKeys(record, ["cwd", "errors", "hooks", "warnings"]) &&
        record.cwd === workingDirectory &&
        isEmptyArray(record.errors) &&
        isEmptyArray(record.hooks) &&
        isEmptyArray(record.warnings),
    )
  );
}

export function isInertMcpResponse(value: unknown): boolean {
  return (
    isObject(value) &&
    hasExactKeys(value, ["data", "nextCursor"]) &&
    Array.isArray(value.data) &&
    value.data.every(
      (record) =>
        isObject(record) &&
        hasExactKeys(record, [
          "authStatus",
          "name",
          "resourceTemplates",
          "resources",
          "serverInfo",
          "tools",
        ]) &&
        typeof record.authStatus === "string" &&
        isNonEmptyString(record.name) &&
        isEmptyArray(record.resourceTemplates) &&
        isEmptyArray(record.resources) &&
        record.serverInfo === null &&
        isEmptyObject(record.tools),
    ) &&
    value.nextCursor === null
  );
}

export function isThreadStartResponse(value: unknown, cwd: string): value is ThreadStartResponse {
  if (!isObject(value) || !isObject(value.sandbox) || !isObject(value.thread)) return false;
  return (
    value.approvalPolicy === "never" &&
    value.cwd === cwd &&
    Array.isArray(value.instructionSources) &&
    value.instructionSources.length === 0 &&
    value.model === "gpt-5.4-mini" &&
    value.modelProvider === "openai" &&
    value.reasoningEffort === "low" &&
    value.sandbox.networkAccess === false &&
    value.sandbox.type === "readOnly" &&
    value.thread.ephemeral === true &&
    isNonEmptyString(value.thread.id)
  );
}

export function isTurnStartResponse(value: unknown): value is TurnStartResponse {
  return (
    isObject(value) &&
    isObject(value.turn) &&
    isNonEmptyString(value.turn.id) &&
    value.turn.status === "inProgress"
  );
}

export function parseAppServerNotification(notification: JsonRpcNotification): ParsedNotification {
  if (isUnsafeMethod(notification.method)) return { kind: "unsafe" };
  const params = notification.params;
  if (notification.method === "item/agentMessage/delta") {
    if (
      !isObject(params) ||
      !isNonEmptyString(params.threadId) ||
      !isNonEmptyString(params.turnId) ||
      !isNonEmptyString(params.itemId) ||
      typeof params.delta !== "string"
    ) {
      return { kind: "invalid" };
    }
    return {
      delta: params.delta,
      itemId: params.itemId,
      kind: "agentDelta",
      threadId: params.threadId,
      turnId: params.turnId,
    };
  }
  if (notification.method === "item/started" || notification.method === "item/completed") {
    if (
      !isObject(params) ||
      !isNonEmptyString(params.threadId) ||
      !isNonEmptyString(params.turnId) ||
      !isObject(params.item) ||
      !isNonEmptyString(params.item.id) ||
      !isNonEmptyString(params.item.type)
    ) {
      return { kind: "invalid" };
    }
    return {
      item: { id: params.item.id, text: params.item.text, type: params.item.type },
      kind: "item",
      lifecycle: notification.method === "item/started" ? "started" : "completed",
      threadId: params.threadId,
      turnId: params.turnId,
    };
  }
  if (notification.method === "turn/completed") {
    if (
      !isObject(params) ||
      !isNonEmptyString(params.threadId) ||
      !isObject(params.turn) ||
      !isNonEmptyString(params.turn.id) ||
      !isNonEmptyString(params.turn.status)
    ) {
      return { kind: "invalid" };
    }
    return {
      error: params.turn.error,
      kind: "turnCompleted",
      status: params.turn.status,
      threadId: params.threadId,
      turnId: params.turn.id,
    };
  }
  return { kind: "ignore" };
}

export async function initializeAppServerChannel(
  channel: JsonRpcChannel,
  workingDirectory: string,
): Promise<void> {
  const initialized = await channel.request("initialize", {
    capabilities: { experimentalApi: true, requestAttestation: false },
    clientInfo: { name: "huayi", title: "Huayi Native Host", version: "0.8.0" },
  });
  if (!isInitializeResponse(initialized)) throw new AppServerInvariantError();
  channel.notify("initialized");
  const hooks = await channel.request("hooks/list", { cwds: [workingDirectory] });
  const mcpServers = await channel.request("mcpServerStatus/list", {
    detail: "toolsAndAuthOnly",
    limit: 128,
  });
  if (!isSafeHooksResponse(hooks, workingDirectory) || !isInertMcpResponse(mcpServers)) {
    throw new AppServerInvariantError();
  }
}

export async function startAppServerThread(
  channel: JsonRpcChannel,
  workingDirectory: string,
): Promise<ThreadStartResponse> {
  const response = await channel.request("thread/start", {
    approvalPolicy: "never",
    baseInstructions: HUAYI_BASE_INSTRUCTIONS,
    config: HUAYI_THREAD_CONFIG,
    cwd: workingDirectory,
    developerInstructions: HUAYI_DEVELOPER_INSTRUCTIONS,
    ephemeral: true,
    model: "gpt-5.4-mini",
    modelProvider: "openai",
    sandbox: "read-only",
    serviceName: "huayi",
  });
  if (!isThreadStartResponse(response, workingDirectory)) throw new AppServerInvariantError();
  return response;
}

export async function startAppServerTurn(
  channel: JsonRpcChannel,
  workingDirectory: string,
  threadId: string,
  request: { outputSchema: unknown; prompt: string },
  onTurnStartSent?: () => void,
): Promise<TurnStartResponse> {
  const pendingResponse = channel.request("turn/start", {
    approvalPolicy: "never",
    cwd: workingDirectory,
    effort: "low",
    input: [{ text: request.prompt, text_elements: [], type: "text" }],
    model: "gpt-5.4-mini",
    outputSchema: request.outputSchema,
    sandboxPolicy: { networkAccess: false, type: "readOnly" },
    threadId,
  });
  try {
    onTurnStartSent?.();
  } catch {
    // A diagnostic timing hook must not affect the App Server request lifecycle.
  }
  const response = await pendingResponse;
  if (!isTurnStartResponse(response)) throw new AppServerInvariantError();
  return response;
}
