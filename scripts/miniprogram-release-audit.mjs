import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const testModule =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?|test-support|(?:^|[/\\])__tests__(?:[/\\]|$)|vitest|jsdom)/iu;
const secret =
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:HUAYI_WECHAT_APP_SECRET|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|DATABASE_URL|OPENAI_API_KEY|DEEPSEEK_API_KEY|appsecret)["']?\s*[:=]\s*["'`][^"'`\s]+|\b(?:sb_secret_|sk-)[a-z0-9_-]{20,}|postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@|\beyJ[a-z0-9_-]{16,}\.[a-z0-9_-]{16,}\.[a-z0-9_-]{16,}/iu;
export const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");

export async function auditReleaseArtifacts({ output, reportPath, config }) {
  const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
  const project = await readJson(join(output, "project.config.json"));
  assert.equal(project.appid, config.appId, "Artifact AppID must match release identity.");
  assert.equal(project.compileType, "miniprogram", "Expected a mini-program package.");
  assert.equal(project.setting?.urlCheck, true, "Strict legal-domain checking must be enabled.");
  assert.deepEqual(
    await readJson(join(output, "release-identity.json")),
    config,
    "Artifact identity differs.",
  );
  const app = await readJson(join(output, "app.json"));
  assert(
    app.pages?.includes("pages/login/index") && app.pages?.includes("pages/practice/index"),
    "Missing essential pages.",
  );
  const bundle = await readJson(reportPath);
  const names = [];
  function collect(modules = []) {
    for (const module of modules) {
      if (module.name) names.push(module.name);
      collect(module.modules);
    }
  }
  collect(bundle.modules);
  assert(names.length > 0, "Missing actual weapp module report.");
  assert(!names.some((name) => testModule.test(name)), "Test modules must not enter weapp.");
  assert(
    names.some((name) => /react@18\.3\.1(?:[/\\]|$)/u.test(name)),
    "Expected React 18.3.1 runtime.",
  );
  assert(
    !names.some((name) => /(?:^|[/\\_])react(?:-dom)?@(?!18\.3\.1(?:[/\\_]|$))\d/u.test(name)),
    "Unexpected React runtime version.",
  );
  const files = {};
  let hasCompiledOrigin = false;
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const path = join(directory, entry.name);
      assert(!entry.isSymbolicLink(), "Release artifacts must not contain symlinks.");
      assert(!testModule.test(name), "Test files must not enter weapp.");
      if (entry.isDirectory()) await visit(path, `${name}/`);
      else {
        const bytes = await readFile(path);
        const text = bytes.toString("utf8");
        assert(!secret.test(text), "Potential server credential found in release artifact.");
        assert(
          !/(?:^|\/)\.env(?:\.|$)|\.(?:pem|key)$/iu.test(name),
          "Secret/config file must not enter weapp.",
        );
        if (name === "project.private.config.json") {
          assert.notEqual(
            JSON.parse(text).setting?.urlCheck,
            false,
            "Private project config disables strict domains.",
          );
        }
        if (name.endsWith(".js") && text.includes(config.apiOrigin)) hasCompiledOrigin = true;
        files[name] = sha256(bytes);
      }
    }
  }
  await visit(output);
  assert(hasCompiledOrigin, "Configured API origin is absent from compiled JavaScript.");
  return {
    status: "passed",
    identity: config,
    modules: names.length,
    pages: app.pages.length,
    bundleReportSha256: sha256(await readFile(reportPath)),
    files,
    limitations: [
      "Local artifact audit only; backend identity, legal domains and device acceptance remain required.",
    ],
  };
}
