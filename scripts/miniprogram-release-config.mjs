import assert from "node:assert/strict";

export function validateReleaseConfig(env, packageVersion, headSha) {
  const config = {
    appId: env.HUAYI_MINIPROGRAM_APP_ID,
    apiOrigin: env.HUAYI_MINIPROGRAM_API_ORIGIN,
    version: env.HUAYI_MINIPROGRAM_RELEASE_VERSION,
    candidateSha: env.HUAYI_MINIPROGRAM_RELEASE_SHA,
  };
  assert(/^wx[a-f0-9]{16}$/u.test(config.appId ?? ""), "Release requires a real AppID.");
  assert(
    /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(config.apiOrigin ?? ""),
    "Release requires an explicit HTTPS origin without credentials, port, path or trailing slash.",
  );
  const host = new URL(config.apiOrigin).hostname;
  assert(
    !/(?:^|\.)(?:localhost|local|invalid|test|example|example\.com|example\.org|example\.net)$/u.test(
      host,
    ) && !/(?:^|[.-])(?:acceptance|staging|sandbox|test|dev)(?:[.-]|$)/u.test(host),
    "Release requires a production API origin, not a development or placeholder target.",
  );
  assert(/^\d+\.\d+\.\d+$/u.test(config.version ?? ""), "Release version must be explicit.");
  assert.equal(
    config.version,
    packageVersion,
    "Release version must match the mini-program package.",
  );
  assert(
    /^[a-f0-9]{40}$/u.test(config.candidateSha ?? ""),
    "Release requires a full candidate SHA.",
  );
  assert.equal(config.candidateSha, headSha, "Candidate SHA must match HEAD.");
  return config;
}
