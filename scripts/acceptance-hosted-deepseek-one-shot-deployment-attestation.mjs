import { readVercelOneShotSnapshot } from "./acceptance-vercel-one-shot-remote.mjs";

const failureMessage = "Hosted deployment attestation failed closed.";
const requestBudgetMilliseconds = 5_000;
const maximumRuntimeResponseBytes = 1_000_000;
const commitPattern = /^[0-9a-f]{40}$/u;
const deploymentIdPattern = /^dpl_[A-Za-z0-9_-]{3,128}$/u;
const inFlightStates = new Set(["BUILDING", "INITIALIZING", "QUEUED"]);

function failedClosed() {
  return new Error(failureMessage);
}

function createBoundedFetch({ clearTimeout_, fetch_, setTimeout_ }) {
  return async (url, init = {}) => {
    const controller = new AbortController();
    let rejectDeadline;
    let stopped = false;
    const deadline = new Promise((_, reject) => {
      rejectDeadline = reject;
    });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout_(timer);
    };
    const abort = () => {
      if (stopped) return;
      controller.abort();
      rejectDeadline(failedClosed());
    };
    const timer = setTimeout_(abort, requestBudgetMilliseconds);
    let response;
    try {
      response = await Promise.race([
        Promise.resolve().then(() =>
          fetch_(url, { ...init, method: init.method ?? "GET", signal: controller.signal }),
        ),
        deadline,
      ]);
    } catch {
      stop();
      throw failedClosed();
    }
    if (
      typeof response !== "object" ||
      response === null ||
      typeof response.ok !== "boolean" ||
      !Number.isSafeInteger(response.status) ||
      typeof response.text !== "function"
    ) {
      stop();
      throw failedClosed();
    }
    if (!response.ok) stop();
    return {
      headers: response.headers,
      ok: response.ok,
      status: response.status,
      async text() {
        try {
          return await Promise.race([Promise.resolve().then(() => response.text()), deadline]);
        } catch {
          throw failedClosed();
        } finally {
          stop();
        }
      },
    };
  };
}

function selectReadyDeployment(history) {
  if (
    !Array.isArray(history) ||
    history.length === 0 ||
    history.some(({ state }) => inFlightStates.has(state))
  ) {
    throw failedClosed();
  }
  const deployment = history.find(({ state }) => state !== "CANCELED");
  if (
    deployment?.state !== "READY" ||
    typeof deployment.id !== "string" ||
    !deploymentIdPattern.test(deployment.id) ||
    typeof deployment.sha !== "string" ||
    !commitPattern.test(deployment.sha)
  ) {
    throw failedClosed();
  }
  return Object.freeze({
    commit: deployment.sha,
    deploymentId: deployment.id,
    state: "READY",
  });
}

function header(response, name) {
  if (typeof response.headers?.get !== "function") throw failedClosed();
  const value = response.headers.get(name);
  return typeof value === "string" ? value : "";
}

function mediaTypeIs(response, expected) {
  return header(response, "content-type").split(";", 1)[0].trim().toLowerCase() === expected;
}

async function readRuntimeText({ accept, boundedFetch, contentType, url }) {
  const response = await boundedFetch(url, {
    headers: { Accept: accept },
    method: "GET",
    redirect: "error",
  });
  if (!response.ok) throw failedClosed();
  const body = await response.text();
  if (
    response.status !== 200 ||
    !mediaTypeIs(response, contentType) ||
    typeof body !== "string" ||
    body.length === 0 ||
    Buffer.byteLength(body, "utf8") > maximumRuntimeResponseBytes
  ) {
    throw failedClosed();
  }
  return { body, response };
}

function assertRuntimeHeaders(response, deployment) {
  if (
    header(response, "x-huayi-deployment-commit") !== deployment.commit ||
    header(response, "x-huayi-deployment-id") !== deployment.deploymentId ||
    header(response, "x-huayi-release-channel") !== "hosted-acceptance"
  ) {
    throw failedClosed();
  }
}

async function attestApi(boundedFetch, deployment) {
  const { body, response } = await readRuntimeText({
    accept: "application/json",
    boundedFetch,
    contentType: "application/json",
    url: "https://api.acceptance.seen-said.cn/health",
  });
  assertRuntimeHeaders(response, deployment);
  let health;
  try {
    health = JSON.parse(body);
  } catch {
    throw failedClosed();
  }
  if (
    typeof health !== "object" ||
    health === null ||
    Array.isArray(health) ||
    Object.keys(health).sort().join("|") !== "service|status" ||
    health.service !== "huayi-cloud-api" ||
    health.status !== "ok"
  ) {
    throw failedClosed();
  }
}

function metaContent(html, name) {
  const pattern = new RegExp(
    `<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']\\s*/?>`,
    "giu",
  );
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) throw failedClosed();
  return matches[0][1];
}

async function attestWeb(boundedFetch, deployment) {
  const { body } = await readRuntimeText({
    accept: "text/html",
    boundedFetch,
    contentType: "text/html",
    url: "https://app.acceptance.seen-said.cn/analysis",
  });
  if (
    metaContent(body, "huayi-deployment-commit") !== deployment.commit ||
    metaContent(body, "huayi-deployment-id") !== deployment.deploymentId ||
    metaContent(body, "huayi-release-channel") !== "hosted-acceptance"
  ) {
    throw failedClosed();
  }
}

export async function captureHostedDeepSeekDeploymentPair({
  clearTimeout_ = clearTimeout,
  fetch_ = globalThis.fetch,
  setTimeout_ = setTimeout,
  token,
} = {}) {
  try {
    if (
      typeof fetch_ !== "function" ||
      typeof setTimeout_ !== "function" ||
      typeof clearTimeout_ !== "function"
    ) {
      throw failedClosed();
    }
    const boundedFetch = createBoundedFetch({ clearTimeout_, fetch_, setTimeout_ });
    const snapshot = await readVercelOneShotSnapshot({ fetch_: boundedFetch, token });
    const deployments = Object.freeze({
      api: selectReadyDeployment(snapshot.api),
      web: selectReadyDeployment(snapshot.web),
    });
    if (deployments.api.deploymentId === deployments.web.deploymentId) throw failedClosed();
    await attestApi(boundedFetch, deployments.api);
    await attestWeb(boundedFetch, deployments.web);
    return deployments;
  } catch {
    throw failedClosed();
  }
}
