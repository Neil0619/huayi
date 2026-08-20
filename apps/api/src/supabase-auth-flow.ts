import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthState } from "./auth-provider.js";

export type SupabaseAuthClient = Pick<SupabaseClient, "auth">;

export interface SupabaseAuthStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

export type SupabaseAuthClientFactory = (storage: SupabaseAuthStorage) => SupabaseAuthClient;

export function createSupabaseAuthFlow(initial: AuthState = {}) {
  const values = new Map(Object.entries(initial));
  return {
    state: (): AuthState => Object.fromEntries(values),
    storage: {
      getItem: async (key: string) => values.get(key) ?? null,
      removeItem: async (key: string) => {
        values.delete(key);
      },
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
    },
  };
}
