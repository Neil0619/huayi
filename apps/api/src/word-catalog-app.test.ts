import { describe, expect, it, vi } from "vitest";
import { wordCatalogQuerySchema } from "@huayi/cloud-contracts";
import { createWordCatalogApp } from "./word-catalog-app.js";

async function unused(): Promise<never> {
  throw new Error("Unexpected word mutation or detail lookup.");
}

function server() {
  const queries = vi.fn((input: unknown) => wordCatalogQuerySchema.parse(input));
  const authenticate = vi.fn(() => "owner-1");
  const app = createWordCatalogApp({
    authenticate,
    catalog: {
      list: async (owner, input) => {
        expect(owner).toBe("owner-1");
        queries(input);
        return { items: [], nextCursor: null };
      },
      state: unused,
      archive: unused,
    },
    words: { delete: unused, get: unused, list: unused, patch: unused, upsert: unused },
  });
  return { app, authenticate, queries };
}

describe("word catalog HTTP query boundaries", () => {
  it.each([
    ["?query=normal&archived=true", { query: "normal", archived: true }],
    ["#?query=hidden", { archived: false }],
    ["#?archived=true", { archived: false }],
    ["?query=visible#?archived=true", { query: "visible", archived: false }],
    ["?query=first&query=second", { query: "first", archived: false }],
    ["?query=tea%23cup", { query: "tea#cup", archived: false }],
  ])("uses only the URL query before a fragment: %s", async (suffix, expected) => {
    const { app, authenticate, queries } = server();
    const response = await app.request(new Request(`https://api.invalid/v2/words${suffix}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(queries).toHaveReturnedWith(expected);
  });

  it("does not turn an encoded path fragment into a query on another route", async () => {
    const { app, authenticate, queries } = server();
    expect((await app.request("https://api.invalid/v2/words%23?query=hidden")).status).toBe(404);
    expect(authenticate).not.toHaveBeenCalled();
    expect(queries).not.toHaveBeenCalled();
  });
});
