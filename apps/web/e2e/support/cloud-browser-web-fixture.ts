import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Route } from "@playwright/test";

const distRoot = fileURLToPath(new URL("../../dist/", import.meta.url));

function mediaType(pathname: string): string {
  return extname(pathname) === ".js"
    ? "text/javascript; charset=utf-8"
    : extname(pathname) === ".css"
      ? "text/css; charset=utf-8"
      : "text/html; charset=utf-8";
}

export async function serveCloudWebDist(route: Route): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  const asset = /^\/assets\/([A-Za-z0-9._-]+)$/u.exec(pathname);
  const assetName = asset?.[1];
  const target =
    assetName === undefined
      ? resolve(distRoot, "index.html")
      : resolve(distRoot, "assets", assetName);
  try {
    await route.fulfill({
      body: await readFile(target),
      contentType: mediaType(target),
      status: 200,
    });
  } catch {
    await route.fulfill({ body: "Not found", status: 404 });
  }
}
