import {
  hostedAcceptanceCaCertificateUrl,
  requireHostedCaCertificate,
} from "./acceptance-hosted-foundation.mjs";

const failureMessage = "Hosted acceptance official CA download failed.";

export async function fetchHostedAcceptanceOfficialCaCertificate({
  fetchImplementation = fetch,
  maxOutputBytes = 16_384,
  timeoutMilliseconds = 10_000,
} = {}) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMilliseconds);
  let reader;
  try {
    const response = await fetchImplementation(hostedAcceptanceCaCertificateUrl, {
      cache: "no-store",
      credentials: "omit",
      method: "GET",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: abortController.signal,
    });
    if (
      response?.ok !== true ||
      response.status !== 200 ||
      response.url !== hostedAcceptanceCaCertificateUrl ||
      response.body === null ||
      typeof response.body?.getReader !== "function"
    ) {
      throw new Error(failureMessage);
    }
    reader = response.body.getReader();
    const chunks = [];
    let outputBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error(failureMessage);
      outputBytes += value.byteLength;
      if (outputBytes > maxOutputBytes) throw new Error(failureMessage);
      chunks.push(value);
    }
    const certificate = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, outputBytes),
    );
    if (
      !/^-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/=]+\n)+-----END CERTIFICATE-----\n$/u.test(
        certificate,
      )
    ) {
      throw new Error(failureMessage);
    }
    return requireHostedCaCertificate({
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: certificate,
    });
  } catch {
    throw new Error(failureMessage);
  } finally {
    clearTimeout(timeout);
    if (reader !== undefined) {
      try {
        await reader.cancel();
      } catch {
        // The response is already unusable; cleanup remains best effort.
      }
      try {
        reader.releaseLock();
      } catch {
        // The bounded response reader is process-local and cannot retain the certificate.
      }
    }
  }
}
