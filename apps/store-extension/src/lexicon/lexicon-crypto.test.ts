import { expect, it } from "vitest";

import { createLexiconCryptoContext } from "./lexicon-crypto.js";

it("rejects a truncated device key before deriving lexicon keys", async () => {
  await expect(
    createLexiconCryptoContext(globalThis.crypto, new Uint8Array(31)),
  ).rejects.toMatchObject({ code: "data-corrupt" });
});

it("rejects an authenticated record whose word differs from its opaque identity", async () => {
  const context = await createLexiconCryptoContext(globalThis.crypto, new Uint8Array(32));
  const entry = {
    contexts: [],
    createdAt: "2026-09-22T00:00:00.000Z",
    headword: "apple",
    id: "apple",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
  const matching = await context.encryptRecord(entry, await context.opaqueId("apple"), 1);
  await expect(context.decryptRecord(matching)).resolves.toEqual(entry);

  // AES-GCM authentication alone cannot detect a producer binding the wrong word to an ID.
  const mismatched = await context.encryptRecord(entry, await context.opaqueId("zebra"), 1);
  await expect(context.decryptRecord(mismatched)).rejects.toMatchObject({ code: "data-corrupt" });
});
