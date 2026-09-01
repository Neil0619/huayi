import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const scriptsDirectory = new URL("./", import.meta.url);

test("Hosted and Vercel scripts contain no infrastructure-secret runtime prompt or child env", async () => {
  const filenames = (await readdir(scriptsDirectory)).filter(
    (filename) =>
      /^(?:acceptance-hosted|acceptance-vercel)-.*\.mjs$/u.test(filename) &&
      !filename.endsWith(".test.mjs"),
  );
  const forbiddenPatterns = [
    /Supabase administrator database password:/u,
    /Supabase application database password:/u,
    /Source archive administrator database password:/u,
    /Supabase recovery management token:/u,
    /Vercel token:/u,
    /PGPASSWORD\s*:/u,
    /SUPABASE_ACCESS_TOKEN\s*:/u,
    /VERCEL_TOKEN\s*:/u,
    /environment\.(?:PGPASSWORD|SUPABASE_DB_PASSWORD|SUPABASE_ACCESS_TOKEN|VERCEL_TOKEN)/u,
    /password-prompt/u,
    /hidden TTY password/u,
    /prompt for the administrator secret/u,
  ];

  for (const filename of filenames) {
    const source = await readFile(new URL(filename, scriptsDirectory), "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${filename} contains ${pattern}`);
    }
    if (source.includes("readHostedAdministratorPassword")) {
      assert.doesNotMatch(source, /\breadPassword\(\)/u, `${filename} drops its environment`);
    }
  }
});

test("package exposes the five fixed Hosted credential lifecycle commands", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(packageDocument.scripts).filter(([name]) =>
        name.startsWith("acceptance:hosted:credentials:"),
      ),
    ),
    {
      "acceptance:hosted:credentials:configure":
        "node scripts/acceptance-hosted-credentials.mjs configure",
      "acceptance:hosted:credentials:diagnose":
        "node scripts/acceptance-hosted-credentials.mjs diagnose",
      "acceptance:hosted:credentials:remove":
        "node scripts/acceptance-hosted-credentials.mjs remove",
      "acceptance:hosted:credentials:rotate":
        "node scripts/acceptance-hosted-credentials.mjs rotate",
      "acceptance:hosted:credentials:status":
        "node scripts/acceptance-hosted-credentials.mjs status",
    },
  );
});
