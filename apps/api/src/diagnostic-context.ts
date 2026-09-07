import { AsyncLocalStorage } from "node:async_hooks";
import {
  diagnosticCodeSchema,
  diagnosticEventSchema,
  diagnosticOperationSchema,
  diagnosticVersionSchema,
  type DiagnosticEvent,
} from "@huayi/cloud-contracts";

export interface DiagnosticWrite {
  event: DiagnosticEvent;
  userId: string | null;
}
export type DiagnosticWriter = (records: DiagnosticWrite[]) => Promise<void>;
type Fields = Partial<
  Pick<
    DiagnosticEvent,
    "requestId" | "taskId" | "generationId" | "operation" | "release" | "clientVersion"
  >
> & { userId?: string };
interface Scope {
  fields: Fields;
  records: Map<string, DiagnosticWrite>;
  started: number;
  write: DiagnosticWriter;
}
const scopes = new AsyncLocalStorage<Scope>();

/** Async context contains only allowlisted metadata, never a request, Error, input or token. */
export async function runDiagnosticScope<T>(
  options: Fields & { write: DiagnosticWriter },
  operation: () => Promise<T>,
): Promise<T> {
  const { write, ...fields } = options;
  const scope: Scope = { fields, records: new Map(), started: performance.now(), write };
  return scopes.run(scope, async () => {
    try {
      return await operation();
    } finally {
      const records = [...scope.records.values()];
      if (records.length) {
        try {
          await write(records);
        } catch {
          // Preserve safe events in the platform log if persistence is unavailable.
          try {
            console.error(
              JSON.stringify({ level: "error", event: "diagnostics_persistence_failed", records }),
            );
          } catch {
            /* A console adapter cannot change the business outcome either. */
          }
        }
      }
    }
  });
}
export function setDiagnosticContext(fields: Fields): void {
  const scope = scopes.getStore();
  if (scope) Object.assign(scope.fields, fields);
}
export function diagnosticScopeOptions() {
  const scope = scopes.getStore();
  return scope ? { ...scope.fields, write: scope.write } : undefined;
}
export function setDiagnosticOperationIfAbsent(operation: DiagnosticEvent["operation"]): void {
  const scope = scopes.getStore();
  if (scope && !scope.fields.operation) scope.fields.operation = operation;
}
export function discardCancelledTaskDiagnostics(): void {
  const scope = scopes.getStore();
  if (scope)
    for (const [key, record] of scope.records)
      if (record.event.taskId === scope.fields.taskId) scope.records.delete(key);
}
export function diagnosticClientVersion(value: unknown): { clientVersion?: string } {
  const result = diagnosticVersionSchema.safeParse(value);
  return result.success ? { clientVersion: result.data } : {};
}
export function diagnosticOperation(value: unknown): DiagnosticEvent["operation"] {
  const parsed = diagnosticOperationSchema.safeParse(value);
  return parsed.success ? parsed.data : "learning-task";
}
export function diagnosticCode(value: unknown): DiagnosticEvent["code"] {
  const parsed = diagnosticCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : "internal_error";
}
export function captureDiagnostic(
  input: Pick<DiagnosticEvent, "code" | "stage"> & Partial<DiagnosticEvent>,
): void {
  const scope = scopes.getStore();
  if (!scope || scope.records.size >= 32) return;
  // Expected authentication rejections must remain independent of database availability.
  if (
    !scope.fields.userId &&
    input.stage === "http" &&
    ["authentication_required", "forbidden", "client_upgrade_required"].includes(input.code)
  )
    return;
  const { userId, ...fields } = scope.fields;
  const parsed = diagnosticEventSchema.safeParse({
    version: 1,
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    source: "api",
    severity: "error",
    operation: "http",
    durationMs: Math.min(86_400_000, Math.round(performance.now() - scope.started)),
    ...fields,
    ...input,
  });
  if (!parsed.success) return;
  const event = parsed.data;
  const key = JSON.stringify([
    event.taskId,
    event.generationId,
    event.operation,
    event.code,
    event.stage,
    event.httpStatus,
    event.attempt,
    event.severity,
  ]);
  if (!scope.records.has(key)) scope.records.set(key, { event, userId: userId ?? null });
}
