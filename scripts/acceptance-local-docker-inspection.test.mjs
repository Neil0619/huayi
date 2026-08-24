import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalDockerHubRepoDigest,
  resolveLocalDockerInspectionTarget,
} from "./acceptance-local-docker-inspection.mjs";

test("Docker Hub repo-digest normalization is exact and does not accept registry aliases", () => {
  const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(
    canonicalDockerHubRepoDigest("docker.io/supabase/postgres", digest),
    `supabase/postgres@${digest}`,
  );
  assert.equal(canonicalDockerHubRepoDigest("docker.io/library/kong", digest), `kong@${digest}`);
  assert.equal(canonicalDockerHubRepoDigest("public.ecr.aws/supabase/postgres", digest), null);
  assert.equal(canonicalDockerHubRepoDigest("docker.io/", digest), null);
});

test("local Docker resolver binds only the current-user OrbStack socket on macOS", async () => {
  const inspectedPaths = [];
  const target = await resolveLocalDockerInspectionTarget({
    environment: {},
    getCurrentUser: () => ({ homedir: "/Users/current-user" }),
    inspectPath: async (path) => {
      inspectedPaths.push(path);
      return {
        isFile: () => path.endsWith("/docker"),
        isSocket: () => path.endsWith("/docker.sock"),
        mode: 0o100755,
      };
    },
    platform: "darwin",
  });

  assert.deepEqual(target, {
    command: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
    host: "unix:///Users/current-user/.orbstack/run/docker.sock",
  });
  assert.deepEqual(inspectedPaths, [
    "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
    "/Users/current-user/.orbstack/run/docker.sock",
  ]);
});

test("local Docker resolver keeps Linux on the fixed system socket and executable", async () => {
  const target = await resolveLocalDockerInspectionTarget({
    environment: {},
    inspectPath: async (path) => ({
      isFile: () => path === "/usr/bin/docker",
      isSocket: () => path === "/var/run/docker.sock",
      mode: 0o100755,
    }),
    platform: "linux",
  });

  assert.deepEqual(target, {
    command: "/usr/bin/docker",
    host: "unix:///var/run/docker.sock",
  });
});

test("local Docker resolver rejects every environment selector and unsupported platform", async () => {
  for (const environment of [
    { DOCKER_HOST: "tcp://private.example.test:2376" },
    { DOCKER_HOST: "unix:///tmp/untrusted.sock" },
    { DOCKER_CONTEXT: "remote-private" },
    { DOCKER_HOST: "", DOCKER_CONTEXT: "" },
    { DOCKER_HOST: undefined },
  ]) {
    await assert.rejects(
      resolveLocalDockerInspectionTarget({
        environment,
        inspectPath: async () => {
          throw new Error("must not inspect paths");
        },
        platform: "darwin",
      }),
      /Docker environment selectors are forbidden/u,
    );
  }
  await assert.rejects(
    resolveLocalDockerInspectionTarget({
      environment: {},
      inspectPath: async () => {
        throw new Error("must not inspect paths");
      },
      platform: "win32",
    }),
    /Docker inspection platform is unsupported/u,
  );
});

test("local Docker resolver fails closed for missing, non-socket, or non-executable paths", async () => {
  for (const inspectPath of [
    async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    async (path) => ({
      isFile: () => path.endsWith("/docker"),
      isSocket: () => false,
      mode: 0o100755,
    }),
    async (path) => ({
      isFile: () => path.endsWith("/docker"),
      isSocket: () => path.endsWith("/docker.sock"),
      mode: path.endsWith("/docker") ? 0o100644 : 0o140755,
    }),
  ]) {
    await assert.rejects(
      resolveLocalDockerInspectionTarget({
        environment: {},
        getCurrentUser: () => ({ homedir: "/Users/current-user" }),
        inspectPath,
        platform: "darwin",
      }),
      /Local Docker inspection target is unavailable/u,
    );
  }
});
