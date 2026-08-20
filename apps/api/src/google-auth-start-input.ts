import { googleAuthStartRequestSchema } from "@huayi/cloud-contracts";
import type { Context } from "hono";

import { CloudFault } from "./cloud-fault.js";

function invalidInput(): never {
  throw new CloudFault("invalid_request", "The request body is invalid.");
}

export async function googleAuthStartInput(context: Context) {
  const contentType = context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType === "application/json") {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      throw new CloudFault("invalid_request", "Expected a JSON request body.");
    }
    const parsed = googleAuthStartRequestSchema.safeParse(input);
    return parsed.success ? parsed.data : invalidInput();
  }
  if (contentType !== "application/x-www-form-urlencoded") return invalidInput();

  const entries = [...new URLSearchParams(await context.req.text()).entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "claimTicket") return invalidInput();
  const parsed = googleAuthStartRequestSchema.safeParse({ claimTicket: entries[0][1] });
  return parsed.success ? parsed.data : invalidInput();
}
