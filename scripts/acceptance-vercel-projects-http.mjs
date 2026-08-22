import { operationError, responseStatus } from "./acceptance-vercel-projects-diagnostics.mjs";

const apiOrigin = "https://api.vercel.com";
const maximumResponseBytes = 1_000_000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function urlFor(pathname, query = {}) {
  const url = new URL(pathname, apiOrigin);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
  return url.href;
}

export async function requestJson({
  allowNotFound = false,
  body,
  fetch_,
  method = "GET",
  stage,
  token,
  url,
}) {
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch_(url, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method,
    });
  } catch {
    throw operationError("Vercel REST request failed.", stage, "transport-failed", "unavailable");
  }
  if (allowNotFound && response.status === 404) return undefined;
  if (!response.ok) {
    throw operationError(
      "Vercel REST request failed.",
      stage,
      "request-rejected",
      responseStatus(response),
    );
  }
  let text;
  try {
    text = await response.text();
  } catch {
    throw operationError(
      "Vercel REST response failed.",
      stage,
      "response-invalid",
      responseStatus(response),
    );
  }
  if (text.length === 0 || text.length > maximumResponseBytes) {
    throw operationError(
      "Vercel REST response failed.",
      stage,
      "response-invalid",
      responseStatus(response),
    );
  }
  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw operationError(
      "Vercel REST response failed.",
      stage,
      "response-invalid",
      responseStatus(response),
    );
  }
}
