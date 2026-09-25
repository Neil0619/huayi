import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalFileReader, fileSampleDigest } from "./asbplayer-local-files.mjs";

function fixture(file) {
  const records = new Map();
  let permission = "granted";
  let selected = file;
  const directory = {
    queryPermission: async () => permission,
    requestPermission: async () => permission,
    getFileHandle: async (name) => {
      if (name !== selected.name) throw new Error("not found");
      return { getFile: async () => selected };
    },
  };
  const options = {
    storage: {
      get: async (id) => records.get(id),
      set: async (id, handle) => {
        records.set(id, handle);
      },
    },
    pickDirectory: async () => directory,
  };
  return {
    options,
    records,
    permission: (value) => {
      permission = value;
    },
    replace: (value) => {
      selected = value;
    },
  };
}

test("authorized file stays disk-readable without reading its complete body; a restored reader reuses it", async () => {
  const file = new File([new Uint8Array(1_000_000)], "Show.S09E01.浏览器.mp4", {
    lastModified: 1000,
  });
  const descriptor = {
    localName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    sampleDigest: await fileSampleDigest(file),
  };
  file.arrayBuffer = () => {
    throw new Error("whole video read is forbidden");
  };
  file.stream = () => {
    throw new Error("whole video streaming is forbidden during import");
  };
  const setup = fixture(file);
  const first = createLocalFileReader(setup.options);
  await assert.rejects(first.read("directory-a", descriptor), /授权/u);
  await first.authorize("directory-a", descriptor);
  const restored = createLocalFileReader(setup.options);
  assert.equal(await restored.read("directory-a", descriptor), file);
  setup.permission("denied");
  await assert.rejects(restored.read("directory-a", descriptor), /授权/u);
  await assert.rejects(restored.authorize("directory-a", descriptor), /授权/u);
});

test("wrong or changed content is rejected even when the filename, size and timestamp match", async () => {
  const file = new File(["correct"], "episode.mp4", { lastModified: 1000 });
  const descriptor = {
    localName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    sampleDigest: await fileSampleDigest(file),
  };
  const setup = fixture(file);
  const reader = createLocalFileReader(setup.options);
  setup.replace(new File(["changed"], file.name, { lastModified: 1000 }));
  await assert.rejects(reader.authorize("directory-a", descriptor), /不匹配/u);
  assert.equal(setup.records.size, 0);
  setup.replace(file);
  await reader.authorize("directory-a", descriptor);
  setup.replace(new File(["changed"], file.name, { lastModified: 1000 }));
  await assert.rejects(reader.read("directory-a", descriptor), /不匹配/u);
  await assert.rejects(
    reader.read("directory-a", { ...descriptor, localName: "../episode.mp4" }),
    /无效/u,
  );
});
