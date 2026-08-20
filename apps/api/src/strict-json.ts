import type { Context } from "hono";

import { CloudFault } from "./cloud-fault.js";

export async function strictJson<T>(
  context: Context,
  schema: { parse(value: unknown): T },
): Promise<T> {
  let input: unknown;
  try {
    input = await context.req.json();
  } catch {
    throw new CloudFault("invalid_request", "Expected a JSON request body.");
  }
  try {
    return schema.parse(input);
  } catch {
    throw new CloudFault("invalid_request", "The request body is invalid.");
  }
}
