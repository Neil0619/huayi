const hostedAcceptanceApiOrigin = "https://api.acceptance.seen-said.cn";
const hostedAcceptanceWebOrigin = "https://app.acceptance.seen-said.cn";

const opaqueFlowGlob = "?".repeat(43);

const hostedAuthRedirects = Object.freeze([
  `${hostedAcceptanceApiOrigin}/v1/auth/callback\\?flow=${opaqueFlowGlob}`,
  `${hostedAcceptanceApiOrigin}/v1/auth/password/confirm\\?flow=${opaqueFlowGlob}`,
  `${hostedAcceptanceApiOrigin}/v1/auth/password/recovery/confirm\\?flow=${opaqueFlowGlob}`,
  `${hostedAcceptanceApiOrigin}/v1/auth/reauthenticate/google/callback\\?flow=${opaqueFlowGlob}`,
  `${hostedAcceptanceApiOrigin}/v1/account/sign-in-methods/google:callback\\?flow=${opaqueFlowGlob}`,
]);

const hostedAuthConfirmationTemplate = [
  "<p>你的语见验证码是：<strong>{{ .Token }}</strong></p>",
  '<p><a href="{{ .RedirectTo }}">打开语见并输入验证码</a></p>',
].join("\n");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function placeholderCount(content, name) {
  const placeholders = content.matchAll(/\{\{\s*\.([A-Za-z]+)\s*\}\}/gu);
  return [...placeholders].filter((match) => match[1] === name).length;
}

export function verifyHostedInvitationAuthConfiguration(configuration) {
  if (
    !isRecord(configuration) ||
    configuration.site_url !== hostedAcceptanceWebOrigin ||
    configuration.uri_allow_list !== hostedAuthRedirects.join(",") ||
    configuration.mailer_otp_length !== 6 ||
    configuration.mailer_otp_exp !== 3_600 ||
    configuration.mailer_templates_confirmation_content !== hostedAuthConfirmationTemplate ||
    placeholderCount(configuration.mailer_templates_confirmation_content, "Token") !== 1 ||
    placeholderCount(configuration.mailer_templates_confirmation_content, "RedirectTo") !== 1 ||
    placeholderCount(configuration.mailer_templates_confirmation_content, "ConfirmationURL") !== 0
  ) {
    throw new Error("Hosted Auth invitation configuration mismatch.");
  }
  return true;
}
