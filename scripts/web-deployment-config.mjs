import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run the selected checkout's actual Vercel entry in a fresh process so imports cannot cache
// another candidate or profile. No caller secrets or Node startup overrides reach that process.
export function readWebDeploymentConfig(repositoryRoot, profile = "hosted-acceptance") {
  try {
    if (!new Set(["hosted-acceptance", "production"]).has(profile)) throw new Error();
    const sourceUrl = pathToFileURL(resolve(repositoryRoot, "apps/web/vercel.mjs")).href;
    const source =
      "const { config } = await import(process.argv[1]); process.stdout.write(JSON.stringify(config));";
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", source, sourceUrl],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...Object.fromEntries(
            ["SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"].flatMap((name) =>
              typeof process.env[name] === "string" ? [[name, process.env[name]]] : [],
            ),
          ),
          VITE_DEPLOYMENT_ENVIRONMENT: profile,
          VITE_API_ORIGIN:
            profile === "production"
              ? "https://api.seen-said.cn"
              : "https://api.acceptance.seen-said.cn",
        },
        maxBuffer: 65_536,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5_000,
        windowsHide: true,
      },
    );
    const config = JSON.parse(output);
    if (config === null || typeof config !== "object" || Array.isArray(config)) throw new Error();
    return config;
  } catch {
    throw new Error("Web deployment configuration is invalid.");
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 3) throw new Error();
    process.stdout.write(JSON.stringify(readWebDeploymentConfig(process.cwd(), process.argv[2])));
  } catch {
    process.stderr.write("Web deployment configuration is invalid.\n");
    process.exitCode = 1;
  }
}
