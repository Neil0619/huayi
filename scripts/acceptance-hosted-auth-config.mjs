import { pathToFileURL } from "node:url";

import { verifyHostedInvitationAuthConfiguration } from "./acceptance-hosted-auth-contract.mjs";
import {
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

export { verifyHostedInvitationAuthConfiguration } from "./acceptance-hosted-auth-contract.mjs";

const managementApiOrigin = "https://api.supabase.com";
const maximumResponseBytes = 1_000_000;
const requestTimeoutMilliseconds = 10_000;

export const hostedAuthConfigStatusArgument = `--status-hosted-auth-config-${hostedAcceptanceProjectRef}`;
export const hostedAuthConfigApplyConfirmation = `--confirm-hosted-email-otp-length-6-${hostedAcceptanceProjectRef}`;
export const hostedAuthConfigDiagnosticArgument = `--diagnose-hosted-auth-config-${hostedAcceptanceProjectRef}`;
export const hostedInvitationAuthConfigStatusArgument = `--status-hosted-invitation-auth-config-${hostedAcceptanceProjectRef}`;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validAccessToken(token) {
  return (
    typeof token === "string" &&
    token.length >= 16 &&
    token.length <= 4_096 &&
    token.trim() === token &&
    !/[\r\n\0]/u.test(token)
  );
}

function requireAccessToken(token) {
  if (!validAccessToken(token)) {
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
  const configuration = await parseAuthConfigurationResponse(response);
  if (configuration === undefined) {
    throw new Error("Supabase Auth configuration response failed.");
  }
  return configuration;
}

async function parseAuthConfigurationResponse(response) {
  let text;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (text.length === 0 || text.length > maximumResponseBytes) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function diagnosticOutput(result) {
  return [
    `token_format_exact|${result.tokenFormatExact}`,
    `request_reached|${result.requestReached}`,
    `http_status|${result.httpStatus}`,
    `response_json_record|${result.responseJsonRecord}`,
    `otp_length_state|${result.otpLengthState}`,
    `contract_exact|${result.contractExact}`,
  ];
}

async function diagnoseAuthConfiguration({ fetch_, token }) {
  const result = {
    tokenFormatExact: "f",
    requestReached: "not_run",
    httpStatus: "not_run",
    responseJsonRecord: "not_run",
    otpLengthState: "not_run",
    contractExact: "f",
  };
  if (!validAccessToken(token)) return diagnosticOutput(result);
  result.tokenFormatExact = "t";
  let response;
  try {
    response = await fetch_(authConfigUrl(), {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
  } catch {
    result.requestReached = "f";
    return diagnosticOutput(result);
  }
  result.requestReached = "t";
  result.httpStatus =
    Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
      ? String(response.status)
      : "invalid";
  if (response.ok !== true) return diagnosticOutput(result);
  const configuration = await parseAuthConfigurationResponse(response);
  result.responseJsonRecord = configuration === undefined ? "f" : "t";
  if (configuration === undefined) return diagnosticOutput(result);
  const otpLength = configuration.mailer_otp_length;
  result.otpLengthState =
    otpLength === 6
      ? "six"
      : otpLength === 8
        ? "eight"
        : Object.hasOwn(configuration, "mailer_otp_length")
          ? "other"
          : "missing";
  result.contractExact = result.otpLengthState === "six" ? "t" : "f";
  return diagnosticOutput(result);
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
    arguments_[0] === "diagnose" &&
    arguments_[1] === hostedAuthConfigDiagnosticArgument
  ) {
    return "diagnose";
  }
  if (
    arguments_.length === 2 &&
    arguments_[0] === "status" &&
    arguments_[1] === hostedAuthConfigStatusArgument
  ) {
    return "status";
  }
  if (
    arguments_.length === 2 &&
    arguments_[0] === "invitation-status" &&
    arguments_[1] === hostedInvitationAuthConfigStatusArgument
  ) {
    return "invitation-status";
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
  readCredential = readHostedCredential,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  const operation = parseOperation(arguments_);
  if (operation === undefined) {
    writeError("Hosted Auth configuration arguments are invalid.\n");
    return 1;
  }
  if (operation === "diagnose") {
    try {
      rejectLegacyHostedCredentialEnvironment(environment);
      let token;
      try {
        token = await readCredential("supabase-management-token", { environment });
      } catch {
        token = undefined;
      }
      const lines = await diagnoseAuthConfiguration({ fetch_, token });
      writeOutput(`${lines.join("\n")}\n`);
      return 0;
    } catch {
      writeError("Hosted Auth configuration diagnostic failed.\n");
      return 1;
    }
  }
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
    const token = requireAccessToken(
      await readCredential("supabase-management-token", { environment }),
    );
    const current = await requestAuthConfiguration({ fetch_, method: "GET", token });
    if (operation === "status") {
      verifyHostedAuthConfiguration(current);
      writeOutput("Hosted Auth email OTP length verification passed.\n");
      return 0;
    }
    if (operation === "invitation-status") {
      verifyHostedInvitationAuthConfiguration(current);
      writeOutput("Hosted Auth invitation configuration verification passed.\n");
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
        : operation === "invitation-status"
          ? "Hosted Auth invitation configuration verification failed.\n"
          : "Hosted Auth email OTP length update failed.\n",
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedAuthConfigCli();
}
