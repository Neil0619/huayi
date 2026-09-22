import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const appRequire = createRequire(new URL("../apps/miniprogram/package.json", import.meta.url));
const cliRequire = createRequire(appRequire.resolve("@tarojs/cli/package.json"));
const download = cliRequire("download-git-repo");
const AdmZip = cliRequire("adm-zip");

function archive(entries) {
  const chunks = [];
  for (const { name, data = "", type = "0", link = "" } of entries) {
    const body = Buffer.from(data);
    const header = Buffer.alloc(512);
    const field = (value, offset, length) => header.write(value, offset, length, "utf8");
    field(name, 0, 100);
    field("0000644\0", 100, 8);
    field("0000000\0", 108, 8);
    field("0000000\0", 116, 8);
    field(body.length.toString(8).padStart(11, "0") + "\0", 124, 12);
    field("00000000000\0", 136, 12);
    field("        ", 148, 8);
    field(type, 156, 1);
    field(link, 157, 100);
    field("ustar\0", 257, 6);
    field("00", 263, 2);
    const sum = header.reduce((total, byte) => total + byte, 0);
    field(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}

async function fixture(t, data, run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taro-download-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const server = http.createServer((_request, response) => response.end(data));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const source = `direct:http://127.0.0.1:${server.address().port}/template.tar`;
  await run({ root, source, destination: path.join(root, "out") });
}

function get(source, destination, options = {}) {
  return new Promise((resolve, reject) => {
    download(source, destination, options, (error) => (error ? reject(error) : resolve()));
  });
}

test("Taro template download extracts normal ZIP and TAR with one root stripped", async (t) => {
  const zip = new AdmZip();
  zip.addFile("repo/template/package.json", Buffer.from('{"name":"self-owned-template"}'));
  for (const data of [
    zip.toBuffer(),
    archive([{ name: "repo/template/package.json", data: '{"name":"self-owned-template"}' }]),
  ]) {
    await fixture(t, data, async ({ source, destination }) => {
      await get(source, destination);
      assert.deepEqual(
        JSON.parse(await fs.readFile(path.join(destination, "template/package.json"))),
        { name: "self-owned-template" },
      );
    });
  }
});

test("Taro CLI fetchTemplate accepts the replacement callback and installs template choices", async (t) => {
  const fetchTemplate = cliRequire("./dist/create/fetchTemplate.js").default;
  const data = archive([{ name: "repo/package.json", data: '{"name":"cli-template"}' }]);
  await fixture(t, data, async ({ source, destination }) => {
    const choices = await fetchTemplate(source, destination, false);
    assert.deepEqual(choices, [{ name: "template.tar", value: "template.tar", desc: "" }]);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(destination, "template.tar/package.json"))),
      { name: "cli-template" },
    );
    await assert.rejects(fs.access(path.join(destination, "taro-temp")));
  });
});

test("Taro download preserves URL Basic auth and strips it on cross-origin redirects", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taro-auth-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = archive([{ name: "repo/package.json", data: '{"name":"auth-fixture"}' }]);
  const received = [];
  const target = http.createServer((request, response) => {
    received.push({ origin: "target", authorization: request.headers.authorization });
    response.end(data);
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => target.close(resolve)));
  const source = http.createServer((request, response) => {
    received.push({ origin: "source", authorization: request.headers.authorization });
    if (request.url === "/redirect") {
      response.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/archive` });
      response.end();
    } else response.end(data);
  });
  await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => source.close(resolve)));
  const url = new URL(`http://127.0.0.1:${source.address().port}/archive`);
  url.username = "self-owned user";
  url.password = "self-owned:pass";
  await get(`direct:${url.href}`, path.join(root, "direct"));
  url.pathname = "/redirect";
  await get(`direct:${url.href}`, path.join(root, "redirect"));
  const authorization = `Basic ${Buffer.from("self-owned user:self-owned:pass").toString("base64")}`;
  assert.deepEqual(received, [
    { origin: "source", authorization },
    { origin: "source", authorization },
    { origin: "target", authorization: undefined },
  ]);
  assert.equal(
    await fs.readFile(path.join(root, "redirect/package.json"), "utf8"),
    '{"name":"auth-fixture"}',
  );
});

test("Taro archive confines normalized sibling-prefix paths to the extraction root", async (t) => {
  await fixture(
    t,
    archive([{ name: "repo/../out-sibling/marker", data: "owned" }]),
    async ({ root, source, destination }) => {
      await get(source, destination);
      await assert.rejects(fs.access(path.join(root, "out-sibling/marker")));
      assert.equal(await fs.readFile(path.join(destination, "marker"), "utf8"), "owned");
    },
  );
});

test("Taro archive rejects paths still escaping after root stripping", async (t) => {
  const data = archive([{ name: "../../out-sibling/marker", data: "owned" }]);
  await fixture(t, data, async ({ root, source, destination }) => {
    await assert.rejects(get(source, destination));
    await assert.rejects(fs.access(path.join(root, "out-sibling/marker")));
  });
});

test("Taro archive rejects escaping symbolic and hard links", async (t) => {
  for (const type of ["1", "2"]) {
    await fixture(
      t,
      archive([{ name: "repo/escape", type, link: "../outside/marker" }]),
      async ({ root, source, destination }) => {
        await fs.mkdir(path.join(root, "outside"));
        await fs.writeFile(path.join(root, "outside/marker"), "unchanged");
        await assert.rejects(get(source, destination));
        assert.equal(await fs.readFile(path.join(root, "outside/marker"), "utf8"), "unchanged");
      },
    );
  }
});

test("Taro archive rejects parent traversal through a link chain before creating links", async (t) => {
  for (const link of ["b/../outside/marker", "b\\..\\outside\\marker"]) {
    await fixture(
      t,
      archive([
        { name: "repo/b", type: "2", link: "." },
        { name: "repo/readme", type: "2", link },
      ]),
      async ({ root, source, destination }) => {
        await fs.mkdir(path.join(root, "outside"));
        await fs.writeFile(path.join(root, "outside/marker"), "unchanged");
        await assert.rejects(get(source, destination), /link|target|outside/i);
        await assert.rejects(fs.lstat(path.join(destination, "readme")));
        assert.equal(await fs.readFile(path.join(root, "outside/marker"), "utf8"), "unchanged");
      },
    );
  }
});

test("Taro archive preserves an ordinary relative link inside the template", async (t) => {
  const data = archive([
    { name: "repo/target", data: "local template data" },
    { name: "repo/link", type: "2", link: "target" },
  ]);
  await fixture(t, data, async ({ source, destination }) => {
    await get(source, destination);
    assert.equal(await fs.readFile(path.join(destination, "link"), "utf8"), "local template data");
  });
});

test("Taro archive cannot traverse an existing output directory link", async (t) => {
  const data = archive([{ name: "repo/link/marker", data: "changed" }]);
  await fixture(t, data, async ({ root, source, destination }) => {
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.mkdir(destination);
    await fs.writeFile(path.join(outside, "marker"), "unchanged");
    await fs.symlink(outside, path.join(destination, "link"), "junction");
    const error = await get(source, destination).then(
      () => null,
      (failure) => failure,
    );
    assert.equal(await fs.readFile(path.join(outside, "marker"), "utf8"), "unchanged");
    assert.ok(error instanceof Error, "Extraction must reject an output directory link escape");
  });
});

test("Taro clone preserves callback API, paths with spaces, and explicit Git ref", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taro clone test "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "source repo");
  await fs.mkdir(repo);
  const hooks = path.join(root, "empty-hooks");
  await fs.mkdir(hooks);
  const gitConfig = path.join(root, "gitconfig");
  await fs.writeFile(gitConfig, "");
  const environment = {
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: hooks,
    GIT_CONFIG_KEY_1: "commit.gpgsign",
    GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_PARAMETERS: "",
  };
  const saved = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });
  const git = (...args) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", `core.hooksPath=${hooks}`, ...args], {
      cwd: repo,
      stdio: "pipe",
    });
  git("init", "--initial-branch=fixture");
  await fs.writeFile(path.join(repo, "package.json"), '{"name":"clone-fixture"}');
  git("add", "package.json");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  );
  git("branch", "other");
  const destination = path.join(root, "target repo");
  await get(`direct:${repo}#fixture`, destination, { clone: true });
  assert.equal(
    await fs.readFile(path.join(destination, "package.json"), "utf8"),
    '{"name":"clone-fixture"}',
  );
  await assert.rejects(fs.access(path.join(destination, ".git")));
  const shallowDestination = path.join(root, "shallow repo");
  await get(`direct:${pathToFileURL(repo).href}#other`, shallowDestination, {
    clone: true,
    shallow: true,
  });
  assert.equal(
    await fs.readFile(path.join(shallowDestination, "package.json"), "utf8"),
    '{"name":"clone-fixture"}',
  );
  const revision = git("rev-parse", "HEAD").toString().trim();
  await get(`direct:${pathToFileURL(repo).href}#${revision}`, path.join(root, "commit repo"), {
    clone: true,
    shallow: true,
  });
  await assert.rejects(
    get(`direct:${repo}#--orphan=unexpected`, path.join(root, "bad ref"), { clone: true }),
    /checkout argument/,
  );
});

test("Taro clone rejects option-like repositories before starting Git", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taro-clone-option-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(
    get("direct:--upload-pack=bad#master", path.join(root, "repo"), { clone: true }),
    /repository|URL|argument/i,
  );
  await assert.rejects(
    get("direct:ext::unsupported-helper#master", path.join(root, "transport"), { clone: true }),
    /protocol/i,
  );
});
