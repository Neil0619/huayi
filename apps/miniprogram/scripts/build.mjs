import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const appId = process.env.HUAYI_MINIPROGRAM_APP_ID ?? "touristappid";
if (appId !== "touristappid" && !/^wx[a-f0-9]{16}$/u.test(appId))
  throw new Error("Invalid mini-program AppID.");
const cli = resolve(dirname(require.resolve("@tarojs/cli/package.json")), "bin/taro");
const child = spawn(process.execPath, [cli, "build", "--type", "weapp"], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});
const code = await new Promise((resolveCode, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolveCode(signal === null ? code : 1));
});
if (code !== 0) process.exitCode = code ?? 1;
else {
  const project = JSON.parse(await readFile(resolve(root, "project.config.json"), "utf8"));
  await writeFile(
    resolve(root, "dist/project.config.json"),
    JSON.stringify({ ...project, appid: appId }, null, 2) + "\n",
  );
  process.stdout.write(
    appId === "touristappid"
      ? "Compiled offline preview; configure a real AppID and HTTPS origin before device acceptance.\n"
      : "Compiled WeChat package with the configured AppID.\n",
  );
}
