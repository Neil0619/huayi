import { createClient } from "@supabase/supabase-js";

import { CloudFault } from "./cloud-fault.js";

interface StorageBucket {
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{
    data: { signedUrl: string } | null;
    error: unknown;
  }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ): Promise<{ error: unknown }>;
}
interface AccountDataClient {
  auth: {
    admin: {
      deleteUser(userId: string, shouldSoftDelete: boolean): Promise<{ error: unknown }>;
    };
  };
  storage: { from(bucket: string): StorageBucket };
}

export function createSupabaseAccountDataAuthority(options: {
  bucket: string;
  client: AccountDataClient;
  supabaseUrl: string;
}) {
  const expectedOrigin = new URL(options.supabaseUrl).origin;
  const expectedSignedPathPrefix = `/storage/v1/object/sign/${options.bucket}/`;
  const bucket = options.client.storage.from(options.bucket);
  return {
    async deleteAuthUser(userId: string): Promise<void> {
      const { error } = await options.client.auth.admin.deleteUser(userId, false);
      if (error !== null) throw new Error("Supabase Auth deletion failed.");
    },
    async deleteObjects(keys: string[]): Promise<void> {
      if (keys.length === 0) return;
      const { error } = await bucket.remove(keys);
      if (error !== null) throw new Error("Supabase object deletion failed.");
    },
    signedUrls: {
      async create(objectKey: string, validForSeconds: number) {
        const { data, error } = await bucket.createSignedUrl(objectKey, validForSeconds);
        if (error !== null || data === null) {
          throw new CloudFault("not_found", "The export is not downloadable.");
        }
        const parsed = new URL(data.signedUrl);
        if (
          parsed.protocol !== "https:" ||
          parsed.origin !== expectedOrigin ||
          !parsed.pathname.startsWith(expectedSignedPathPrefix) ||
          parsed.username !== "" ||
          parsed.password !== ""
        ) {
          throw new CloudFault("forbidden", "The signed URL authority is invalid.");
        }
        return { url: parsed.toString() };
      },
    },
    async upload(objectKey: string, content: Uint8Array): Promise<void> {
      const { error } = await bucket.upload(objectKey, content, {
        contentType: "application/x-ndjson; charset=utf-8",
        upsert: false,
      });
      if (error !== null) throw new Error("Supabase object upload failed.");
    },
  };
}

export function createSupabaseServiceRoleClient(options: { serviceRoleKey: string; url: string }) {
  return createClient(options.url, options.serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

export type SupabaseAccountDataAuthority = ReturnType<typeof createSupabaseAccountDataAuthority>;
