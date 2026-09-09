import { defineConfig } from "@tarojs/cli";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Compiler } from "webpack";

const apiOrigin = process.env.HUAYI_MINIPROGRAM_API_ORIGIN ?? "";
if (apiOrigin && !/^https:\/\/[a-z0-9.-]+$/u.test(apiOrigin))
  throw new Error("Mini-program API must be an HTTPS origin.");

export default defineConfig({
  projectName: "seen-said-miniprogram",
  date: "2026-09-09",
  designWidth: 375,
  deviceRatio: { 375: 2 },
  sourceRoot: "src",
  outputRoot: "dist",
  framework: "react",
  compiler: "webpack5",
  plugins: ["@tarojs/plugin-platform-weapp"],
  defineConstants: { MINIPROGRAM_API_ORIGIN: JSON.stringify(apiOrigin) },
  mini: {
    // Taro's webpackbar passes removed ProgressPlugin options in newer Webpack.
    // Keep compiler validation and diagnostics; omit only the terminal progress bar.
    webpackChain(chain) {
      chain.plugins.delete("webpackbar");
      chain.plugin("mini-bundle-report").use(
        class {
          apply(compiler: Compiler) {
            compiler.hooks.done.tap("MiniBundleReport", (stats) => {
              const directory = resolve(process.cwd(), "../../artifacts/miniprogram");
              mkdirSync(directory, { recursive: true });
              writeFileSync(
                resolve(directory, "bundle-report.json"),
                JSON.stringify(
                  stats.toJson({ all: false, assets: true, modules: true, nestedModules: true }),
                  null,
                  2,
                ),
              );
            });
          }
        },
      );
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
      url: { enable: false },
      cssModules: { enable: false },
    },
  },
  copy: {
    patterns: [{ from: "project.config.json", to: "dist/project.config.json" }],
    options: {},
  },
});
