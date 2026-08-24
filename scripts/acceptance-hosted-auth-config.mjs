import { pathToFileURL } from "node:url";

import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const managementApiOrigin = "https://api.supabase.com";
const maximumResponseBytes = 1_000_000;

export const hostedAuthConfigStatusArgument = `--status-hosted-auth-config-${hostedAcceptanceProjectRef}`;
export const hostedAuthConfigApplyConfirmation = `--confirm-hosted-email-otp-length-6-${hostedAcceptanceProjectRef}`;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireAccessToken(environment) {
  const token = environment.SUPABASE_ACCESS_TOKEN;
  if (
    typeof token !== "string" ||
    token.length < 16 ||
    token.length > 4_096 ||
    token.trim() !== token ||
    /[\r\n\0]/u.test(token)
  ) {
    throw new Error("Supabase access token is unavailable.");
  }
  return token;
}

function authConfigUrl() {
  return new URL(
    `/v1/projects/${encodeURIComponent(hostedAcceptanceProjectRef)}/config/auth`,
    managementApiOrigin,
  ).href;
}

async function requestAuthConfiguration({ body, fetch_, method, token }) {
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch_(authConfigUrl(), {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers,
      method,
    });
  } catch {
    throw new Error("Supabase Auth configuration request failed.");
  }
  if (!response.ok) throw new Error("Supabase Auth configuration request failed.");
  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error("Supabase Auth configuration response failed.");
  }
  if (text.length === 0 || text.length > maximumResponseBytes) {
    throw new Error("Supabase Auth configuration response failed.");
  }
  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new Error("Supabase Auth configuration response failed.");
  }
}

export function verifyHostedAuthConfiguration(configuration) {
  if (!isRecord(configuration) || configuration.mailer_otp_length !== 6) {
    throw new Error("Hosted Auth email OTP length mismatch.");
  }
  return true;
}

function validCurrentOtpLength(configuration) {
  return (
    isRecord(configuration) &&
    (configuration.mailer_otp_length === 6 || configuration.mailer_otp_length === 8)
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function configurationWithoutOtpLength(configuration) {
  const copy = { ...configuration };
  delete copy.mailer_otp_length;
  return copy;
}

function parseOperation(arguments_) {
  if (
    arguments_.length === 2 &&
    arguments_[0] === "status" &&
    arguments_[1] === hostedAuthConfigStatusArgument
  ) {
    return "status";
  }
  if (
    arguments_.length === 2 &&
    arguments_[0] === "apply" &&
    arguments_[1] === hostedAuthConfigApplyConfirmation
  ) {
    return "apply";
  }
  return undefined;
}

export async function runHostedAuthConfigCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  const operation = parseOperation(arguments_);
  if (operation === undefined) {
    writeError("Hosted Auth configuration arguments are invalid.\n");
    return 1;
  }
  try {
    const token = requireAccessToken(environment);
    const current = await requestAuthConfiguration({ fetch_, method: "GET", token });
    if (operation === "status") {
      verifyHostedAuthConfiguration(current);
      writeOutput("Hosted Auth email OTP length verification passed.\n");
      return 0;
    }
    if (!validCurrentOtpLength(current)) {
      throw new Error("Hosted Auth email OTP length is invalid.");
    }
    if (current.mailer_otp_length === 6) {
      writeOutput("Hosted Auth email OTP length is already 6; no update was required.\n");
      return 0;
    }
    await requestAuthConfiguration({
      body: { mailer_otp_length: 6 },
      fetch_,
      method: "PATCH",
      token,
    });
    const persisted = await requestAuthConfiguration({ fetch_, method: "GET", token });
    verifyHostedAuthConfiguration(persisted);
    if (
      canonicalJson(configurationWithoutOtpLength(current)) !==
      canonicalJson(configurationWithoutOtpLength(persisted))
    ) {
      throw new Error("Hosted Auth configuration changed outside the OTP length.");
    }
    writeOutput("Hosted Auth email OTP length updated to 6 and verified.\n");
    return 0;
  } catch {
    writeError(
      operation === "status"
        ? "Hosted Auth email OTP length verification failed.\n"
        : "Hosted Auth email OTP length update failed.\n",
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedAuthConfigCli();
}
