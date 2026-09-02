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

export const hostedLegacyPasswordRecoveryTemplate = [
  "<h2>Reset your password</h2>",
  "",
  "<p>We received a request to reset your password. Follow the link below to choose a new one.</p>",
  '<p><a href="{{ .ConfirmationURL }}">Reset password</a></p>',
  "",
  "<p>If you didn't request this, you can safely ignore this email.</p>",
].join("\n");

export const hostedPasswordRecoveryTemplate = [
  "<h2>重置语见 · Seen & Said 密码</h2>",
  "",
  "<p>我们收到了你的密码恢复请求。只有在你主动发起时才继续。</p>",
  '<p><a href="{{ .RedirectTo }}&amp;code={{ .TokenHash }}">继续重置密码</a></p>',
  "",
  "<p>如果不是你发起的，请忽略此邮件。</p>",
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

function verifyPasswordRecoveryEnvelope(configuration) {
  if (
    !isRecord(configuration) ||
    configuration.site_url !== hostedAcceptanceWebOrigin ||
    configuration.uri_allow_list !== hostedAuthRedirects.join(",") ||
    configuration.mailer_otp_exp !== 3_600
  ) {
    throw new Error("Hosted Auth password recovery configuration mismatch.");
  }
}

export function verifyHostedLegacyPasswordRecoveryAuthConfiguration(configuration) {
  verifyPasswordRecoveryEnvelope(configuration);
  if (
    configuration.mailer_templates_recovery_content !== hostedLegacyPasswordRecoveryTemplate ||
    placeholderCount(configuration.mailer_templates_recovery_content, "ConfirmationURL") !== 1 ||
    placeholderCount(configuration.mailer_templates_recovery_content, "RedirectTo") !== 0 ||
    placeholderCount(configuration.mailer_templates_recovery_content, "TokenHash") !== 0
  ) {
    throw new Error("Hosted Auth password recovery configuration mismatch.");
  }
  return true;
}

export function verifyHostedPasswordRecoveryAuthConfiguration(configuration) {
  verifyPasswordRecoveryEnvelope(configuration);
  if (
    configuration.mailer_templates_recovery_content !== hostedPasswordRecoveryTemplate ||
    placeholderCount(configuration.mailer_templates_recovery_content, "ConfirmationURL") !== 0 ||
    placeholderCount(configuration.mailer_templates_recovery_content, "RedirectTo") !== 1 ||
    placeholderCount(configuration.mailer_templates_recovery_content, "TokenHash") !== 1 ||
    placeholderCount(configuration.mailer_templates_recovery_content, "Token") !== 0
  ) {
    throw new Error("Hosted Auth password recovery configuration mismatch.");
  }
  return true;
}
