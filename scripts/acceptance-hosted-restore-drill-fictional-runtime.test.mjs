import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedRestoreFictionalSourceContainer,
  hostedRestoreFictionalTargetContainer,
  runHostedRestoreFictionalArchive,
} from "./acceptance-hosted-restore-drill-fictional-runtime.mjs";
import {
  hostedRestoreFictionalCountOutput,
  hostedRestoreFictionalVerificationOutput,
} from "./acceptance-hosted-restore-drill-fictional-fixture.mjs";
import { hostedImportantBatchPostgresRuntimeReference } from "./acceptance-hosted-important-batch-execution-contract.mjs";

const dockerTarget = {
  command: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  host: "unix:///Users/fixed/.orbstack/run/docker.sock",
};
const portableModeOptions = process.platform === "win32" ? { privateModeMatches: () => true } : {};

const toc = `;
5; 1259 200 TABLE public profiles postgres
6; 1259 201 TABLE public analysis_jobs postgres
7; 1259 202 TABLE auth users postgres
8; 1259 203 TABLE auth identities postgres
9; 1259 204 TABLE storage buckets postgres
10; 1259 205 TABLE storage objects postgres
11; 1259 206 TABLE huayi_private audit_events postgres
12; 1259 207 TABLE supabase_migrations schema_migrations postgres
13; 1259 208 VIEW public admin_job_projection postgres
14; 0 200 TABLE DATA public profiles postgres
15; 0 201 TABLE DATA public analysis_jobs postgres
16; 0 202 TABLE DATA auth users postgres
17; 0 203 TABLE DATA auth identities postgres
18; 0 204 TABLE DATA storage buckets postgres
19; 0 205 TABLE DATA storage objects postgres
20; 0 206 TABLE DATA huayi_private audit_events postgres
21; 0 207 TABLE DATA supabase_migrations schema_migrations postgres
22; 2606 300 CONSTRAINT public profiles profiles_pkey postgres
23; 3256 301 POLICY public profiles owner_isolation postgres
24; 2620 302 TRIGGER public analysis_jobs audit_analysis_job postgres
`;

function exactInspection(name) {
  return `${JSON.stringify({
    Config: {
      Image: hostedImportantBatchPostgresRuntimeReference,
      Labels: { "com.seen-said.acceptance": `phase-87-fictional-${name}` },
    },
    HostConfig: {
      Binds: null,
      NetworkMode: "none",
      Tmpfs: {
        "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=2147483648,mode=0700",
      },
    },
    Mounts: [],
  })}\n`;
}

function createFakeRuntime({
  badVerification = false,
  lateSource = false,
  occupied = null,
  targetCleanupThrows = false,
} = {}) {
  const active = new Set();
  const calls = [];
  let copiedArchivePath;
  let sourceAppearsLate = false;
  let targetInspections = 0;
  const runProcess = async (command, arguments_, options = {}) => {
    calls.push({ arguments_, command, input: options.input });
    const operation = arguments_[2];
    if (operation === "container" && arguments_[3] === "inspect") {
      const name = arguments_.at(-1);
      if (name === hostedRestoreFictionalTargetContainer) {
        targetInspections += 1;
        if (targetCleanupThrows && targetInspections === 3)
          throw new Error("private cleanup error");
      }
      if (name === hostedRestoreFictionalSourceContainer && sourceAppearsLate) {
        sourceAppearsLate = false;
        active.add(name);
        return { code: 1, stdout: "[]\n" };
      }
      if (occupied === name || active.has(name)) return { code: 0, stdout: exactInspection(name) };
      return { code: 1, stdout: "[]\n" };
    }
    if (operation === "run") {
      const name = arguments_[arguments_.indexOf("--name") + 1];
      if (name === hostedRestoreFictionalSourceContainer && lateSource) {
        sourceAppearsLate = true;
        return { code: null, stdout: "" };
      }
      active.add(name);
      return { code: 0, stdout: "fictional-container-id\n" };
    }
    if (operation === "exec" && arguments_.includes("head")) return { code: 0, stdout: "1\n" };
    if (operation === "exec" && arguments_.includes("pg_isready")) return { code: 0, stdout: "" };
    if (
      operation === "exec" &&
      arguments_.includes("pg_restore") &&
      arguments_.includes("--list")
    ) {
      return { code: 0, stdout: toc };
    }
    if (operation === "exec" && arguments_.includes("psql")) {
      if (options.input?.includes("postgres_image_ready")) {
        return { code: 0, stdout: "postgres_image_ready|t\n" };
      }
      if (options.input?.includes("verification_contract")) {
        return {
          code: 0,
          stdout: badVerification
            ? hostedRestoreFictionalVerificationOutput.replace(
                "cross_tenant_denied|t",
                "cross_tenant_denied|f",
              )
            : hostedRestoreFictionalVerificationOutput,
        };
      }
      if (options.input?.includes("count_contract")) {
        return { code: 0, stdout: hostedRestoreFictionalCountOutput };
      }
      return { code: 0, stdout: "" };
    }
    if (operation === "cp") {
      const destination = arguments_.at(-1);
      if (!destination.startsWith(`${hostedRestoreFictionalTargetContainer}:`)) {
        copiedArchivePath = destination;
        await writeFile(destination, "PGDMPfictional-archive", { mode: 0o600 });
      }
      return { code: 0, stdout: "" };
    }
    if (operation === "rm") {
      const name = arguments_.at(-1);
      active.delete(name);
      return { code: 0, stdout: `${name}\n` };
    }
    return { code: 0, stdout: "" };
  };
  return {
    calls,
    copiedArchivePath: () => copiedArchivePath,
    runProcess,
  };
}

test("fictional runner restores a custom archive into a second networkless PG17 target", async () => {
  const fake = createFakeRuntime();
  const result = await runHostedRestoreFictionalArchive({
    ...portableModeOptions,
    environment: {},
    resolveDockerTarget: async () => dockerTarget,
    runProcess: fake.runProcess,
    wait: async () => undefined,
  });
  assert.deepEqual(result, {
    archiveFormatExact: true,
    countDigestEqual: true,
    sourceDestroyed: true,
    targetDestroyed: true,
    tocExact: true,
    verificationExact: true,
  });
  const runCalls = fake.calls.filter((call) => call.arguments_[2] === "run");
  assert.equal(runCalls.length, 2);
  for (const call of runCalls) {
    assert.ok(call.arguments_.includes("--pull"));
    assert.ok(call.arguments_.includes("never"));
    assert.equal(call.arguments_[call.arguments_.indexOf("--network") + 1], "none");
    assert.equal(
      call.arguments_.some((value) => ["--publish", "--volume", "--mount"].includes(value)),
      false,
    );
    assert.ok(call.arguments_.includes(hostedImportantBatchPostgresRuntimeReference));
  }
  assert.ok(fake.calls.some((call) => call.arguments_.includes("pg_dump")));
  assert.ok(fake.calls.some((call) => call.arguments_.includes("pg_restore")));
  assert.ok(fake.calls.some((call) => call.arguments_.includes("--no-owner")));
  assert.ok(fake.calls.some((call) => call.arguments_.includes("--no-privileges")));
  await assert.rejects(access(fake.copiedArchivePath()), { code: "ENOENT" });
});

test("fictional runner uses the injected private archive-mode boundary", async () => {
  const fake = createFakeRuntime();
  let modeChecks = 0;

  await runHostedRestoreFictionalArchive({
    environment: {},
    privateModeMatches: () => {
      modeChecks += 1;
      return true;
    },
    resolveDockerTarget: async () => dockerTarget,
    runProcess: fake.runProcess,
    wait: async () => undefined,
  });

  assert.equal(modeChecks, 1);
});

test("verification drift fails and still destroys both exact containers and private archive", async () => {
  const fake = createFakeRuntime({ badVerification: true });
  await assert.rejects(
    runHostedRestoreFictionalArchive({
      ...portableModeOptions,
      environment: {},
      resolveDockerTarget: async () => dockerTarget,
      runProcess: fake.runProcess,
      wait: async () => undefined,
    }),
    /Hosted restore-drill fictional archive failed/u,
  );
  const removed = fake.calls
    .filter((call) => call.arguments_[2] === "rm")
    .map((call) => call.arguments_.at(-1));
  assert.deepEqual(removed, [
    hostedRestoreFictionalTargetContainer,
    hostedRestoreFictionalSourceContainer,
  ]);
  await assert.rejects(access(fake.copiedArchivePath()), { code: "ENOENT" });
});

test("an occupied fixed identity fails before creation and is never deleted", async () => {
  const fake = createFakeRuntime({ occupied: hostedRestoreFictionalSourceContainer });
  await assert.rejects(
    runHostedRestoreFictionalArchive({
      ...portableModeOptions,
      environment: {},
      resolveDockerTarget: async () => dockerTarget,
      runProcess: fake.runProcess,
    }),
    /Hosted restore-drill fictional archive failed/u,
  );
  assert.equal(
    fake.calls.some((call) => call.arguments_[2] === "run"),
    false,
  );
  assert.equal(
    fake.calls.some((call) => call.arguments_[2] === "rm"),
    false,
  );
});

test("inherited Hosted secrets are rejected before Docker inspection", async () => {
  let resolved = false;
  await assert.rejects(
    runHostedRestoreFictionalArchive({
      ...portableModeOptions,
      environment: { PGPASSWORD: "must-not-be-inherited" },
      resolveDockerTarget: async () => {
        resolved = true;
        return dockerTarget;
      },
    }),
    /Hosted restore-drill fictional archive failed/u,
  );
  assert.equal(resolved, false);
});

test("a source start timeout waits for late appearance and removes only the exact identity", async () => {
  const fake = createFakeRuntime({ lateSource: true });
  await assert.rejects(
    runHostedRestoreFictionalArchive({
      ...portableModeOptions,
      environment: {},
      resolveDockerTarget: async () => dockerTarget,
      runProcess: fake.runProcess,
      wait: async () => undefined,
    }),
    /Hosted restore-drill fictional archive failed/u,
  );
  assert.ok(
    fake.calls.some(
      (call) =>
        call.arguments_[2] === "rm" &&
        call.arguments_.at(-1) === hostedRestoreFictionalSourceContainer,
    ),
  );
});

test("target cleanup rejection cannot prevent the independent source cleanup attempt", async () => {
  const fake = createFakeRuntime({ badVerification: true, targetCleanupThrows: true });
  await assert.rejects(
    runHostedRestoreFictionalArchive({
      ...portableModeOptions,
      environment: {},
      resolveDockerTarget: async () => dockerTarget,
      runProcess: fake.runProcess,
      wait: async () => undefined,
    }),
    /Hosted restore-drill fictional archive failed/u,
  );
  assert.ok(
    fake.calls.some(
      (call) =>
        call.arguments_[2] === "rm" &&
        call.arguments_.at(-1) === hostedRestoreFictionalSourceContainer,
    ),
  );
});
