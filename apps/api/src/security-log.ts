type SafeLogValue = number | string;

const allowedFields = new Set([
  "clientVersion",
  "costMicroUsd",
  "errorCode",
  "inputTokens",
  "latencyMs",
  "modelVersion",
  "outputTokens",
  "priceVersion",
  "requestId",
  "route",
  "status",
]);

export function serializeSafeLog(
  input: Readonly<Record<string, unknown>>,
): Record<string, SafeLogValue> {
  const output: Record<string, SafeLogValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowedFields.has(key) && (typeof value === "string" || typeof value === "number")) {
      output[key] = value;
    }
  }
  return output;
}
