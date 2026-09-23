import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditStoreRelease } from "./check-store-release.mjs";

const manifest = {
  icons: { 16: "icon-16.png", 48: "icon-48.png", 128: "icon-128.png" },
  action: { default_popup: "popup.html" },
  background: { service_worker: "service-worker.js", type: "module" },
  content_scripts: [
    {
      all_frames: false,
      js: ["content-script.js"],
      matches: ["http://*/*", "https://*/*"],
      run_at: "document_idle",
    },
    {
      all_frames: false,
      js: ["youtube-content.js"],
      matches: ["https://youtube.com/*", "https://www.youtube.com/*", "https://m.youtube.com/*"],
      run_at: "document_idle",
    },
    {
      all_frames: false,
      js: ["youtube-main.js"],
      matches: ["https://youtube.com/*", "https://www.youtube.com/*", "https://m.youtube.com/*"],
      run_at: "document_start",
      world: "MAIN",
    },
    {
      all_frames: true,
      js: ["asbplayer-content.js"],
      matches: ["https://app.asbplayer.dev/*"],
      run_at: "document_idle",
    },
    {
      all_frames: true,
      js: ["asbplayer-main.js"],
      matches: ["https://app.asbplayer.dev/*"],
      run_at: "document_start",
      world: "MAIN",
    },
    {
      all_frames: false,
      js: ["shanbay-content.js"],
      matches: ["https://web.shanbay.com/*"],
      run_at: "document_idle",
    },
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src https://api.openai.com https://api.deepseek.com https://api.frdic.com",
  },
  host_permissions: [
    "https://api.openai.com/*",
    "https://api.deepseek.com/*",
    "https://api.frdic.com/*",
  ],
  incognito: "not_allowed",
  manifest_version: 3,
  name: "Huayi Store",
  options_ui: { open_in_tab: true, page: "options.html" },
  permissions: ["alarms", "storage", "unlimitedStorage"],
  web_accessible_resources: [
    { matches: ["http://*/*", "https://*/*"], resources: ["overlay.css"] },
  ],
  version: "1.0.0",
};

const expectedFiles = [
  "icon-16.png",
  "icon-48.png",
  "icon-128.png",
  "brand-theme.css",
  "content-script.js",
  "shanbay-content.js",
  "manifest.json",
  "options.css",
  "options-components.css",
  "options-site-rules.css",
  "page-ui.css",
  "options.html",
  "options.js",
  "overlay.css",
  "shanbay-lemma-licenses.txt",
  "popup.css",
  "popup.html",
  "popup.js",
  "service-worker.js",
  "youtube-content.js",
  "youtube-main.js",
  "asbplayer-content.js",
  "asbplayer-main.js",
];

async function withReleaseFixture(run, outputName = "dist-release") {
  const root = await mkdtemp(join(tmpdir(), "huayi-store-release-"));
  const sourceDirectory = join(root, "apps/store-extension");
  const distDirectory = join(sourceDirectory, outputName);
  await mkdir(distDirectory, { recursive: true });
  await mkdir(join(sourceDirectory, "assets"), { recursive: true });
  try {
    for (const file of expectedFiles) {
      const contents = file.endsWith(".png")
        ? await readFile(new URL(`../apps/store-extension/assets/${file}`, import.meta.url))
        : file === "manifest.json"
          ? JSON.stringify(manifest)
          : "/* packaged */";
      await writeFile(join(distDirectory, file), contents);
      if (file.endsWith(".png")) await writeFile(join(sourceDirectory, "assets", file), contents);
    }
    await writeFile(join(sourceDirectory, "manifest.json"), JSON.stringify(manifest));
    await run(root, distDirectory);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("release audit accepts only the reviewed self-contained package", async () => {
  await withReleaseFixture(async (root) => {
    assert.deepEqual(await auditStoreRelease(root), []);
  });
});

test("release audit binds a production package to its own source and output directory", async () => {
  await withReleaseFixture(async (root, distDirectory) => {
    await writeFile(
      join(root, "apps/store-extension/manifest.production.json"),
      JSON.stringify(manifest),
    );
    assert.deepEqual(
      await auditStoreRelease(root, { sourceManifestName: "manifest.production.json" }),
      [],
    );
    await writeFile(
      join(distDirectory, "manifest.json"),
      JSON.stringify({ ...manifest, name: "drift" }),
    );
    assert.notDeepEqual(
      await auditStoreRelease(root, { sourceManifestName: "manifest.production.json" }),
      [],
    );
  }, "dist-production");
});

test("release audit accepts one explicitly reviewed Cloud API host without changing defaults", async () => {
  await withReleaseFixture(async (root, distDirectory) => {
    const apiOrigin = "https://api.huayi.production";
    const cloudManifest = {
      ...manifest,
      content_security_policy: {
        extension_pages: `${manifest.content_security_policy.extension_pages} ${apiOrigin}`,
      },
      host_permissions: [...manifest.host_permissions, `${apiOrigin}/*`],
    };
    await writeFile(
      join(root, "apps/store-extension/manifest.json"),
      JSON.stringify(cloudManifest),
    );
    await writeFile(join(distDirectory, "manifest.json"), JSON.stringify(cloudManifest));

    assert.deepEqual(
      await auditStoreRelease(root, {
        expectedCsp: cloudManifest.content_security_policy.extension_pages,
        expectedHosts: cloudManifest.host_permissions,
      }),
      [],
    );
  });
});

test("release audit can bind an acceptance package to its separate reviewed source manifest", async () => {
  await withReleaseFixture(async (root, distDirectory) => {
    const apiOrigin = "https://api.acceptance.seen-said.cn";
    const acceptanceManifest = {
      ...manifest,
      content_security_policy: {
        extension_pages: `${manifest.content_security_policy.extension_pages} ${apiOrigin}`,
      },
      host_permissions: [...manifest.host_permissions, `${apiOrigin}/*`],
      key: "public-development-key",
    };
    await writeFile(
      join(root, "apps/store-extension/manifest.hosted-acceptance.json"),
      JSON.stringify(acceptanceManifest),
    );
    await writeFile(join(distDirectory, "manifest.json"), JSON.stringify(acceptanceManifest));

    assert.deepEqual(
      await auditStoreRelease(root, {
        expectedCsp: acceptanceManifest.content_security_policy.extension_pages,
        expectedHosts: acceptanceManifest.host_permissions,
        sourceManifestName: "manifest.hosted-acceptance.json",
      }),
      [],
    );
  }, "dist");
});

test("release audit rejects extra artifacts, remote executable code, and Classic markers", async () => {
  await withReleaseFixture(async (root, distDirectory) => {
    await writeFile(join(distDirectory, "host-installer.js"), "nativeMessaging codex");
    await writeFile(
      join(distDirectory, "options.html"),
      '<script src="https://example.test/remote.js"></script>',
    );

    const violations = await auditStoreRelease(root);
    assert.ok(violations.some((value) => value.includes("unexpected package artifact")));
    assert.ok(violations.some((value) => value.includes("remote executable code")));
    assert.ok(violations.some((value) => value.includes("Classic-only marker")));
  });
});

test("release audit rejects permission and source/dist manifest drift", async () => {
  await withReleaseFixture(async (root, distDirectory) => {
    const unsafe = {
      ...manifest,
      host_permissions: [...manifest.host_permissions, "https://example.test/*"],
      permissions: [...manifest.permissions, "nativeMessaging"],
    };
    await writeFile(join(distDirectory, "manifest.json"), JSON.stringify(unsafe));

    const violations = await auditStoreRelease(root);
    assert.ok(violations.some((value) => value.includes("source manifest")));
    assert.ok(violations.some((value) => value.includes("reviewed permissions")));
    assert.ok(violations.some((value) => value.includes("reviewed API hosts")));
  });
});

test("release audit rejects runtime evaluation and Function constructors", async () => {
  await withReleaseFixture(async (root, distDirectory) => {
    await writeFile(
      join(distDirectory, "service-worker.js"),
      [
        'const response = await fetch("/downloaded-code");',
        "const downloadedText = await response.text();",
        "eval(downloadedText);",
        "new Function(downloadedText);",
        "Function(downloadedText)();",
      ].join("\n"),
    );

    const violations = await auditStoreRelease(root);
    assert.ok(violations.some((value) => value.includes("eval is forbidden")));
    assert.ok(violations.some((value) => value.includes("Function constructor is forbidden")));
  });
});

test("release audit rejects an aliased Function constructor in a bundled dependency", async () => {
  await withReleaseFixture(async (root, distDirectory) => {
    await writeFile(
      join(distDirectory, "options.js"),
      ["const CompiledFunction = Function;", 'new CompiledFunction("return payload")();'].join(
        "\n",
      ),
    );

    const violations = await auditStoreRelease(root);
    assert.ok(violations.some((value) => value.includes("Function constructor is forbidden")));
  });
});

test("release audit rejects every importScripts call and all dynamic imports", async () => {
  await withReleaseFixture(async (root, distDirectory) => {
    await writeFile(
      join(distDirectory, "content-script.js"),
      ["importScripts(workerPath);", 'const module = await import("./local-module.js");'].join(
        "\n",
      ),
    );

    const violations = await auditStoreRelease(root);
    assert.ok(violations.some((value) => value.includes("importScripts is forbidden")));
    assert.ok(violations.some((value) => value.includes("dynamic import is forbidden")));
  });
});

test("release audit rejects inline executable scripts and event handlers", async () => {
  await withReleaseFixture(async (root, distDirectory) => {
    await writeFile(
      join(distDirectory, "options.html"),
      [
        '<button type="button" onclick="submitDownloadedCode()">Run</button>',
        '<script type="module">submitDownloadedCode();</script>',
      ].join("\n"),
    );

    const violations = await auditStoreRelease(root);
    assert.ok(violations.some((value) => value.includes("inline event handler is forbidden")));
    assert.ok(violations.some((value) => value.includes("inline executable script is forbidden")));
  });
});

test("release audit permits local script files and ignores inert HTML text", async () => {
  await withReleaseFixture(async (root, distDirectory) => {
    await writeFile(
      join(distDirectory, "options.html"),
      [
        '<!-- <script src="https://example.test/ignored.js"></script> -->',
        '<!-- <button onclick="ignored()">comment</button> -->',
        '<p data-example="onclick=ignored()">eval(downloadedText)</p>',
        '<script type="application/json">{"example":"onclick=ignored()"}</script>',
        '<script type="module" src="./options.js"></script>',
      ].join("\n"),
    );
    await writeFile(
      join(distDirectory, "content-script.js"),
      [
        'const documentation = "eval(code) new Function(code) importScripts(path)";',
        '// import("https://example.test/ignored.js")',
      ].join("\n"),
    );

    assert.deepEqual(await auditStoreRelease(root), []);
  });
});

test("release audit checks forbidden references after a deeply chained dictionary expression", async () => {
  await withReleaseFixture(async (root, dist) => {
    const assignments = Array.from(
      { length: 20000 },
      (_, index) => `dictionary.w${index}=${index}`,
    );
    await writeFile(
      join(dist, "service-worker.js"),
      `let dictionary={};${assignments.join(",")},globalThis["eval"]("bad");`,
    );
    assert((await auditStoreRelease(root)).includes("service-worker.js: eval is forbidden."));
  });
});

test("dictionary numeric word indexes are data while Classic runtime references remain forbidden", async () => {
  await withReleaseFixture(async (root, dist) => {
    await writeFile(
      join(dist, "service-worker.js"),
      "const words={codex:14113};words.codex=14113;",
    );
    assert.deepEqual(await auditStoreRelease(root), []);
    await writeFile(
      join(dist, "service-worker.js"),
      "const words={codex:14113};startCodex(codex);",
    );
    assert(
      (await auditStoreRelease(root)).includes(
        "service-worker.js: Classic-only marker is forbidden in Store package.",
      ),
    );
  });
});

test("dictionary data filtering never hides executable computed properties", async () => {
  await withReleaseFixture(async (root, dist) => {
    for (const source of [
      'const x={[chrome.runtime.connectNative("native-host")]:1};',
      "const x={[codex()]:1};",
    ]) {
      await writeFile(join(dist, "service-worker.js"), source);
      assert(
        (await auditStoreRelease(root)).includes(
          "service-worker.js: Classic-only marker is forbidden in Store package.",
        ),
      );
    }
  });
});

test("release audit rejects corrupt packaged icons", async () => {
  await withReleaseFixture(async (root, dist) => {
    await writeFile(join(dist, "icon-128.png"), "not an icon");
    assert.ok((await auditStoreRelease(root)).some((error) => error.includes("icon-128.png")));
  });
});
