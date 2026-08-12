import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectArchitectureViolations } from "./check-architecture.mjs";

async function withFixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), "huayi-architecture-"));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const target = join(root, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("current Store sources respect package boundaries and contain no production cycles", async () => {
  const violations = await collectArchitectureViolations(
    fileURLToPath(new URL("../", import.meta.url)),
  );

  assert.deepEqual(violations, []);
});

test("architecture check rejects Store-to-Classic and deep package imports", async () => {
  await withFixture(
    {
      "apps/store-extension/src/entry.ts":
        'import "@huayi/protocol";\nimport "@huayi/store-domain/internal.js";\n',
      "packages/store-domain/src/index.ts": 'export const value = "ok";\n',
    },
    async (root) => {
      const violations = await collectArchitectureViolations(root);
      assert.ok(
        violations.some((value) =>
          value.includes(
            "Store Extension may import only @huayi/cloud-contracts or @huayi/store-domain",
          ),
        ),
      );
      assert.ok(violations.some((value) => value.includes("public package export")));
    },
  );
});

test("architecture check rejects platform imports and production dependency cycles", async () => {
  await withFixture(
    {
      "packages/store-domain/src/a.ts":
        'import "node:fs";\nimport { b } from "./b.js";\nexport const a = b;\n',
      "packages/store-domain/src/b.ts": 'import { a } from "./a.js";\nexport const b = a;\n',
    },
    async (root) => {
      const violations = await collectArchitectureViolations(root);
      assert.ok(violations.some((value) => value.includes("platform-neutral")));
      assert.ok(violations.some((value) => value.includes("dependency cycle")));
    },
  );
});

test("architecture check enforces Cloud package direction and platform-neutral learning domain", async () => {
  await withFixture(
    {
      "apps/api/src/entry.ts": 'import "@huayi/protocol";\n',
      "apps/web/src/entry.ts": 'import "@huayi/cloud-contracts/internal.js";\n',
      "packages/cloud-contracts/src/index.ts":
        'import "@huayi/learning-domain";\nimport "@huayi/store-domain";\n',
      "packages/learning-domain/src/index.ts": 'import "node:fs";\n',
      "packages/store-domain/src/index.ts": 'import "@huayi/learning-domain";\n',
    },
    async (root) => {
      const violations = await collectArchitectureViolations(root);
      assert.ok(
        violations.some((value) => value.includes("package boundary forbids @huayi/protocol")),
      );
      assert.ok(
        violations.some((value) => value.includes("package boundary forbids @huayi/store-domain")),
      );
      assert.ok(violations.some((value) => value.includes("public package export")));
      assert.ok(
        violations.some((value) => value.includes("Learning domain must remain platform-neutral")),
      );
      assert.ok(
        !violations.some(
          (value) =>
            value.includes("packages/store-domain/src/index.ts") &&
            value.includes("@huayi/learning-domain"),
        ),
      );
    },
  );
});
