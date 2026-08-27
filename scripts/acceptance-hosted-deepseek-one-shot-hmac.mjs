import { createHmac, timingSafeEqual } from "node:crypto";

export const hostedAcceptanceHmacContext = "huayi.hosted-deepseek-one-shot.idempotency.v1";

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const verifierPattern = /^[0-9a-f]{64}$/u;
const failureMessage = "Hosted acceptance HMAC recovery failed closed.";

function failedClosed() {
  return new Error(failureMessage);
}

function hmac(key, label, operationId, version) {
  return createHmac("sha256", key)
    .update(hostedAcceptanceHmacContext, "utf8")
    .update("\0key-version\0", "utf8")
    .update(String(version), "utf8")
    .update("\0", "utf8")
    .update(label, "utf8")
    .update("\0", "utf8")
    .update(operationId, "utf8")
    .digest();
}

function createMaterial(key, operationId, version) {
  const idempotencyKey = `hda_${hmac(key, "material", operationId, version).toString("base64url")}`;
  const verifier = createHmac("sha256", key)
    .update(hostedAcceptanceHmacContext, "utf8")
    .update("\0key-version\0", "utf8")
    .update(String(version), "utf8")
    .update("\0verifier\0", "utf8")
    .update(idempotencyKey, "utf8")
    .digest("hex");
  return Object.freeze({
    context: hostedAcceptanceHmacContext,
    idempotencyKey,
    verifier,
    version,
  });
}

export function createHostedAcceptanceHmacKeyring({ activeVersion, keys } = {}) {
  if (
    !Number.isSafeInteger(activeVersion) ||
    activeVersion <= 0 ||
    !(keys instanceof Map) ||
    !keys.has(activeVersion)
  ) {
    throw failedClosed();
  }
  const retainedKeys = new Map();
  for (const [version, key] of keys) {
    if (
      !Number.isSafeInteger(version) ||
      version <= 0 ||
      !(key instanceof Uint8Array) ||
      key.byteLength < 32
    ) {
      throw failedClosed();
    }
    retainedKeys.set(version, Buffer.from(key));
  }

  function create(operationId) {
    if (typeof operationId !== "string" || !operationIdPattern.test(operationId)) {
      throw failedClosed();
    }
    return createMaterial(retainedKeys.get(activeVersion), operationId, activeVersion);
  }

  function recover({ context, operationId, verifier, version } = {}) {
    if (
      context !== hostedAcceptanceHmacContext ||
      typeof operationId !== "string" ||
      !operationIdPattern.test(operationId) ||
      !Number.isSafeInteger(version) ||
      version <= 0 ||
      typeof verifier !== "string" ||
      !verifierPattern.test(verifier)
    ) {
      throw failedClosed();
    }
    const key = retainedKeys.get(version);
    if (key === undefined) throw failedClosed();
    const material = createMaterial(key, operationId, version);
    const actual = Buffer.from(material.verifier, "hex");
    const expected = Buffer.from(verifier, "hex");
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
      throw failedClosed();
    }
    return material;
  }

  return Object.freeze({ create, recover });
}
