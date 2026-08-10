import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const outputDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

test("keeps every Manifest entry after the E2E fixture rebuild", async () => {
  const requiredFiles = [
    "content-script.js",
    "manifest.json",
    "options.css",
    "options.html",
    "options.js",
    "popup.css",
    "popup.html",
    "popup.js",
    "service-worker.js",
    "settings.css",
    "youtube-bridge.js",
  ];
  const sizes = await Promise.all(
    requiredFiles.map(async (filename) => (await stat(`${outputDirectory}${filename}`)).size),
  );
  expect(sizes.every((size) => size > 0)).toBe(true);
  const manifest = JSON.parse(await readFile(`${outputDirectory}manifest.json`, "utf8")) as {
    action?: { default_popup?: string };
    options_page?: string;
  };
  expect(manifest.action?.default_popup).toBe("popup.html");
  expect(manifest.options_page).toBe("options.html");
  await expect(readFile(`${outputDirectory}options.html`, "utf8")).resolves.toContain(
    'href="options.css"',
  );
  await expect(readFile(`${outputDirectory}popup.html`, "utf8")).resolves.toContain(
    'href="popup.css"',
  );
});
