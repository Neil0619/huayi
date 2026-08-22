import assert from "node:assert/strict";

export const token = "vercel-test-token-never-print";
export const teamId = "team_seen_said_acceptance";
export const teamQuery = "https://api.vercel.com/v2/teams?limit=100";

export const specs = {
  "seen-said-acceptance-api": {
    id: "prj_seen_said_acceptance_api",
    settings: {
      buildCommand: null,
      framework: "hono",
      nodeVersion: "22.x",
      outputDirectory: null,
      previewDeploymentsDisabled: true,
      resourceConfig: {
        fluid: true,
        functionDefaultRegions: ["sin1"],
        functionDefaultTimeout: 120,
      },
      rootDirectory: "apps/api",
      sourceFilesOutsideRootDirectory: true,
    },
  },
  "seen-said-acceptance-web": {
    id: "prj_seen_said_acceptance_web",
    settings: {
      buildCommand: "pnpm build",
      framework: "vite",
      nodeVersion: "22.x",
      outputDirectory: "dist",
      previewDeploymentsDisabled: true,
      rootDirectory: "apps/web",
      sourceFilesOutsideRootDirectory: true,
    },
  },
};

export function teamResponse() {
  return {
    pagination: { count: 1, next: null, prev: null },
    teams: [{ id: teamId, name: "neil0619's projects", slug: "neil0619s-projects" }],
  };
}

export function blankProject(name) {
  return {
    accountId: teamId,
    buildCommand: null,
    framework: null,
    hasDeployments: false,
    id: specs[name].id,
    latestDeployments: [],
    name,
    nodeVersion: "24.x",
    outputDirectory: null,
    resourceConfig: {},
    rootDirectory: null,
    sourceFilesOutsideRootDirectory: false,
  };
}

export function platformDefaultBlankProject(name) {
  return {
    ...blankProject(name),
    sourceFilesOutsideRootDirectory: true,
  };
}

export function createProjectResponse(name) {
  return {
    ...platformDefaultBlankProject(name),
    alias: [],
    defaultResourceConfig: {},
    deploymentExpiration: {},
    directoryListing: false,
  };
}

export function configuredProject(name) {
  const settings = specs[name].settings;
  return {
    ...blankProject(name),
    ...settings,
    hasDeployments: false,
    latestDeployments: [],
    resourceConfig: settings.resourceConfig ?? {},
  };
}

export function projectUrl(name) {
  return `https://api.vercel.com/v9/projects/${name}?teamId=${teamId}`;
}

export function deploymentUrl(name) {
  return `https://api.vercel.com/v7/deployments?projectId=${specs[name].id}&limit=1&teamId=${teamId}`;
}

export function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

export function createFakeFetch(expectations) {
  const calls = [];
  const fetch_ = async (input, init = {}) => {
    const expected = expectations[calls.length];
    assert.ok(expected, `unexpected request ${String(input)}`);
    const actual = {
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      headers: init.headers,
      method: init.method ?? "GET",
      url: String(input),
    };
    calls.push(actual);
    assert.equal(actual.url, expected.url);
    assert.equal(actual.method, expected.method ?? "GET");
    assert.equal(actual.headers.Authorization, `Bearer ${token}`);
    assert.equal(actual.headers.Accept, "application/json");
    if (expected.body === undefined) {
      assert.equal(actual.body, undefined);
      assert.equal(actual.headers["Content-Type"], undefined);
    } else {
      assert.deepEqual(actual.body, expected.body);
      assert.equal(actual.headers["Content-Type"], "application/json");
    }
    return jsonResponse(expected.status ?? 200, expected.response);
  };
  return {
    calls,
    done() {
      assert.equal(calls.length, expectations.length);
    },
    fetch_,
  };
}

export function deploymentEmpty() {
  return { deployments: [], pagination: { count: 0, next: null, prev: null } };
}

export function missingProjectExpectation(name) {
  return {
    response: { error: { code: "not_found", message: `remote ${name}` } },
    status: 404,
    url: projectUrl(name),
  };
}

export function configureExpectations(name) {
  return [
    {
      body: { name },
      method: "POST",
      response: createProjectResponse(name),
      url: `https://api.vercel.com/v11/projects?teamId=${teamId}`,
    },
    { response: platformDefaultBlankProject(name), url: projectUrl(name) },
    { response: deploymentEmpty(), url: deploymentUrl(name) },
    {
      body: specs[name].settings,
      method: "PATCH",
      response: configuredProject(name),
      url: projectUrl(name),
    },
    { response: configuredProject(name), url: projectUrl(name) },
    { response: deploymentEmpty(), url: deploymentUrl(name) },
  ];
}
