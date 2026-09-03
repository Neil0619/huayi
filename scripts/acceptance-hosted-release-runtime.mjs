import {
  hostedReleaseExtensionId,
  validHostedReleaseAttemptId,
} from "./acceptance-hosted-release-contract.mjs";

const commitPattern = /^[0-9a-f]{40}$/u;
const deploymentPattern = /^dpl_[A-Za-z0-9_-]{3,128}$/u;

function fail() {
  throw new Error("Hosted acceptance release runtime attestation failed closed.");
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function header(response, name) {
  const value = response.headers?.get(name);
  return typeof value === "string" ? value : "";
}

function metaContent(html, name) {
  const matches = [
    ...html.matchAll(
      new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']\\s*/?>`, "giu"),
    ),
  ];
  if (matches.length !== 1) fail();
  return matches[0][1];
}

export function createHostedReleaseRuntime({ fetch_ = globalThis.fetch } = {}) {
  if (typeof fetch_ !== "function") fail();

  async function runtimeFetch(url, init = {}) {
    const response = await fetch_(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!record(response) || typeof response.text !== "function") fail();
    return response;
  }

  return Object.freeze({
    async attest({ apiDeploymentId, candidateSha, releaseAttemptId, webDeploymentId }) {
      try {
        if (
          !commitPattern.test(candidateSha) ||
          !validHostedReleaseAttemptId(releaseAttemptId) ||
          !deploymentPattern.test(apiDeploymentId) ||
          !deploymentPattern.test(webDeploymentId) ||
          apiDeploymentId === webDeploymentId
        ) {
          fail();
        }
        const health = await runtimeFetch("https://api.acceptance.seen-said.cn/health", {
          headers: { Accept: "application/json" },
        });
        const healthBody = JSON.parse(await health.text());
        if (
          health.status !== 200 ||
          header(health, "content-type").split(";", 1)[0] !== "application/json" ||
          healthBody?.service !== "huayi-cloud-api" ||
          healthBody?.status !== "ok" ||
          header(health, "x-huayi-deployment-commit") !== candidateSha ||
          header(health, "x-huayi-deployment-id") !== apiDeploymentId ||
          header(health, "x-huayi-release-channel") !== "hosted-acceptance"
        ) {
          fail();
        }
        const extensionOrigin = `chrome-extension://${hostedReleaseExtensionId}`;
        const cors = await runtimeFetch(
          "https://api.acceptance.seen-said.cn/v1/extension-pairings",
          {
            headers: {
              "Access-Control-Request-Headers": "content-type,x-huayi-client-version",
              "Access-Control-Request-Method": "POST",
              Origin: extensionOrigin,
            },
            method: "OPTIONS",
          },
        );
        if (
          cors.status !== 204 ||
          header(cors, "access-control-allow-origin") !== extensionOrigin ||
          !header(cors, "vary")
            .split(/\s*,\s*/u)
            .includes("Origin")
        ) {
          fail();
        }
        const web = await runtimeFetch("https://app.acceptance.seen-said.cn/analysis", {
          headers: { Accept: "text/html" },
        });
        const html = await web.text();
        if (
          web.status !== 200 ||
          header(web, "content-type").split(";", 1)[0] !== "text/html" ||
          metaContent(html, "huayi-deployment-commit") !== candidateSha ||
          metaContent(html, "huayi-deployment-id") !== webDeploymentId ||
          metaContent(html, "huayi-release-channel") !== "hosted-acceptance"
        ) {
          fail();
        }
      } catch {
        fail();
      }
    },
  });
}
