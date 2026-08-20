import { describe, expect, it, vi } from "vitest";

import { createSupabaseAccountDataAuthority } from "./supabase-account-data-authority.js";

function client(signedUrl: string) {
  const bucket = {
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    upload: vi.fn(async () => ({ data: {}, error: null })),
  };
  return {
    bucket,
    value: {
      auth: { admin: { deleteUser: vi.fn(async () => ({ data: {}, error: null })) } },
      storage: { from: vi.fn(() => bucket) },
    },
  };
}

describe("Supabase account data authority", () => {
  it("keeps private objects in the fixed bucket and signs only the configured HTTPS origin", async () => {
    const fake = client(
      "https://project.supabase.co/storage/v1/object/sign/account-exports/export?token=opaque",
    );
    const authority = createSupabaseAccountDataAuthority({
      bucket: "account-exports",
      client: fake.value,
      supabaseUrl: "https://project.supabase.co",
    });
    await authority.upload("account-exports/export.ndjson", new Uint8Array([1, 2]));
    await authority.deleteObjects(["account-exports/export.ndjson"]);
    await authority.deleteAuthUser("user-1");
    await expect(
      authority.signedUrls.create("account-exports/export.ndjson", 900),
    ).resolves.toEqual({
      url: "https://project.supabase.co/storage/v1/object/sign/account-exports/export?token=opaque",
    });
    expect(fake.value.storage.from).toHaveBeenCalledWith("account-exports");
    expect(fake.bucket.upload).toHaveBeenCalledWith(
      "account-exports/export.ndjson",
      expect.any(Uint8Array),
      { contentType: "application/x-ndjson; charset=utf-8", upsert: false },
    );
  });

  it("rejects a signed URL redirected to another authority", async () => {
    const fake = client("https://attacker.example/export?token=private");
    const authority = createSupabaseAccountDataAuthority({
      bucket: "account-exports",
      client: fake.value,
      supabaseUrl: "https://project.supabase.co",
    });
    await expect(authority.signedUrls.create("export.ndjson", 900)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
