import {
  analysisRequestStatusSchema,
  createAnalysisSseDecoder,
} from "../packages/cloud-contracts/dist/index.js";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";
const maximumJsonBytes = 16 * 1_024;
const maximumSseBytes = 2 * 1_024 * 1_024;
const maximumSseEvents = 256;
const sessionCookiePattern = /^huayi_session=[A-Za-z0-9._~-]{32,2048}$/u;
const setSessionCookiePattern =
  /^(huayi_session=[A-Za-z0-9._~-]{32,2048}); HttpOnly; Secure; SameSite=Lax; Path=\/$/u;
const clearSessionCookie = "huayi_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

export function failedClosed() {
  return new Error(failureMessage);
}

export function hasExactKeys(value, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function requireControl(control, readNowMilliseconds) {
  try {
    if (
      typeof control !== "object" ||
      control === null ||
      Array.isArray(control) ||
      !Number.isSafeInteger(control.deadlineAt) ||
      control.deadlineAt <= readNowMilliseconds() ||
      typeof control.signal !== "object" ||
      control.signal === null ||
      control.signal.aborted === true ||
      typeof control.signal.addEventListener !== "function" ||
      typeof control.signal.removeEventListener !== "function"
    ) {
      throw failedClosed();
    }
    return control.signal;
  } catch {
    throw failedClosed();
  }
}

function contentTypeIs(response, expected) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected;
}

async function readBoundedText(response, maximumBytes) {
  if (response.body === null) throw failedClosed();
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      throw failedClosed();
    }
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  let finished = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) throw failedClosed();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    finished = true;
    return text;
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function parseJsonResponse(response, schema) {
  if (!response.ok || !contentTypeIs(response, "application/json")) throw failedClosed();
  try {
    return schema.parse(JSON.parse(await readBoundedText(response, maximumJsonBytes)));
  } catch {
    throw failedClosed();
  }
}

function setCookieValues(headers) {
  const getSetCookie = headers.getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(headers);
  const value = headers.get("set-cookie");
  return value === null ? [] : [value];
}

export function sessionCookieFromResponse(response) {
  try {
    const values = setCookieValues(response.headers);
    if (values.length !== 1) return undefined;
    return setSessionCookiePattern.exec(values[0])?.[1];
  } catch {
    return undefined;
  }
}

export function responseClearsSession(response) {
  try {
    const values = setCookieValues(response.headers);
    return values.length === 1 && values[0] === clearSessionCookie;
  } catch {
    return false;
  }
}

export function materialIsValid(material) {
  return (
    hasExactKeys(material, ["cookie", "csrfToken"]) &&
    sessionCookiePattern.test(material.cookie) &&
    (material.csrfToken === undefined ||
      (typeof material.csrfToken === "string" &&
        material.csrfToken.length >= 32 &&
        material.csrfToken.length <= 2_048 &&
        !Array.from(material.csrfToken).some((character) => {
          const codePoint = character.codePointAt(0);
          return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
        })))
  );
}

function acceptEvent(state, event) {
  if (state.terminal) throw failedClosed();
  if (event.type === "analysis.started") {
    if (state.requestId !== undefined) throw failedClosed();
    state.requestId = event.requestId;
    return;
  }
  if (state.requestId === undefined) throw failedClosed();
  if (event.type === "analysis.preview") {
    if (event.requestId !== state.requestId) throw failedClosed();
    return;
  }
  if (event.type === "analysis.completed") {
    state.terminal = true;
    return;
  }
  throw failedClosed();
}

export async function consumeAnalysisStream(response) {
  if (!response.ok || !contentTypeIs(response, "text/event-stream") || response.body === null) {
    throw failedClosed();
  }
  const reader = response.body.getReader();
  const textDecoder = new TextDecoder("utf-8", { fatal: true });
  const eventDecoder = createAnalysisSseDecoder();
  const state = { eventCount: 0, requestId: undefined, terminal: false };
  let bytes = 0;
  let disconnected = false;
  let finished = false;
  try {
    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        disconnected = true;
        break;
      }
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumSseBytes) throw failedClosed();
      for (const event of eventDecoder.push(textDecoder.decode(chunk.value, { stream: true }))) {
        state.eventCount += 1;
        if (state.eventCount > maximumSseEvents) throw failedClosed();
        acceptEvent(state, event);
      }
    }
    if (!disconnected) {
      for (const event of eventDecoder.push(textDecoder.decode())) {
        state.eventCount += 1;
        if (state.eventCount > maximumSseEvents) throw failedClosed();
        acceptEvent(state, event);
      }
      for (const event of eventDecoder.finish()) {
        state.eventCount += 1;
        if (state.eventCount > maximumSseEvents) throw failedClosed();
        acceptEvent(state, event);
      }
    }
    finished = !disconnected;
    if (state.requestId === undefined) throw failedClosed();
    return Object.freeze({
      requestId: state.requestId,
      statusReadRequired: disconnected || !state.terminal,
    });
  } catch {
    throw failedClosed();
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readCompletedAnalysisStatus(response, expectedRequestId) {
  const status = await parseJsonResponse(response, analysisRequestStatusSchema);
  if (
    status.requestId !== expectedRequestId ||
    status.state !== "completed" ||
    typeof status.analysisId !== "string"
  ) {
    throw failedClosed();
  }
}
