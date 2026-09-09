import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { miniProgramRoutes } from "@huayi/cloud-contracts";
import { request, session } from "./session";
import { MiniError } from "./errors";

const fake = vi.hoisted(() => ({ request: vi.fn(), code: vi.fn(), remembered: false }));
vi.mock("@tarojs/taro", () => ({
  default: {
    login: fake.code,
    getStorageSync: () => fake.remembered,
    setStorageSync: (_key: string, value: boolean) => {
      fake.remembered = value;
    },
  },
}));
vi.mock(import("./http"), async (importOriginal) => ({
  ...(await importOriginal()),
  rawRequest: fake.request,
}));
const account = { id: "00000000-0000-4000-8000-000000000001", email: null, linkedToWeb: false };
const path = "/v2/learning/tasks";
const options = {
  method: "POST" as const,
  data: { input: { answer: "same answer" } },
  headers: { "Idempotency-Key": "same-intent" },
};
let exchanges = 0;
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  session.clear();
  vi.resetAllMocks();
  vi.stubGlobal("MINIPROGRAM_API_ORIGIN", "https://api.example.test");
  exchanges = 0;
  fake.code.mockResolvedValue({ code: "wx-code" });
  fake.request.mockImplementation(async (url: string) => {
    if (url === miniProgramRoutes.login)
      return {
        state: "authenticated",
        token: String(++exchanges).repeat(43),
        expiresAt: "2099-09-10T00:00:00Z",
      };
    return account;
  });
  await session.login();
});
afterEach(() => vi.unstubAllGlobals());

it.each(["login", "ensure"] as const)(
  "rejects %s with missing configuration before calling WeChat or HTTP",
  async (operation) => {
    session.clear();
    fake.remembered = operation === "ensure";
    vi.clearAllMocks();
    vi.stubGlobal("MINIPROGRAM_API_ORIGIN", "");
    await expect(session[operation]()).rejects.toMatchObject({
      code: "configuration_required",
    });
    expect(session.getSnapshot().account).toBeNull();
    expect(session.getSnapshot().onboarding).toBeNull();
    expect(session.token()).toBeUndefined();
    expect(fake.code).not.toHaveBeenCalled();
    expect(fake.request).not.toHaveBeenCalled();
  },
);

it("reauthenticates after 401 and retries the same body and idempotency key exactly once", async () => {
  fake.request.mockRejectedValueOnce(new MiniError("authentication_required"));
  const result = await request(path, options);
  expect(result).toEqual(account);
  const attempts = fake.request.mock.calls.filter(([url]) => url === path);
  expect(attempts).toEqual([
    [path, { ...options, token: "1".repeat(43) }],
    [path, { ...options, token: "2".repeat(43) }],
  ]);
  expect(attempts[0]?.[1].data).toBe(options.data);
  expect(attempts[1]?.[1].data).toBe(options.data);
  expect(attempts[1]?.[1].headers).toBe(options.headers);
  expect(fake.code).toHaveBeenCalledTimes(2);
});

it("does not loop when the renewed request also receives 401", async () => {
  const transport = fake.request.getMockImplementation();
  fake.request.mockImplementation(async (url, config) => {
    if (url === path) throw new MiniError("authentication_required");
    return transport?.(url, config);
  });
  await expect(request(path, options)).rejects.toMatchObject({ code: "authentication_required" });
  expect(fake.request.mock.calls.filter(([url]) => url === path)).toHaveLength(2);
  expect(fake.code).toHaveBeenCalledTimes(2);
});

it.each(["success", "401"] as const)(
  "rejects a late original %s response after account epoch changes, without reauthenticating",
  async (outcome) => {
    const late = deferred<unknown>();
    fake.request.mockReturnValueOnce(late.promise);
    const pending = request(path, options);
    await Promise.resolve();
    session.clear();
    await session.login();
    const rejected = expect(pending).rejects.toMatchObject({ code: "authentication_required" });
    if (outcome === "success") late.resolve({ privateData: "old owner" });
    else late.reject(new MiniError("authentication_required"));
    await rejected;
    expect(fake.request.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
    expect(fake.code).toHaveBeenCalledTimes(2);
  },
);

it("rejects a late retried response after account epoch changes", async () => {
  const late = deferred<unknown>();
  const retried = deferred<undefined>();
  const transport = fake.request.getMockImplementation();
  let attempts = 0;
  fake.request.mockImplementation(async (url, config) => {
    if (url !== path) return transport?.(url, config);
    if (++attempts === 1) throw new MiniError("authentication_required");
    retried.resolve(undefined);
    return late.promise;
  });
  const pending = request(path, options);
  await retried.promise;
  session.clear();
  await session.login();
  const rejected = expect(pending).rejects.toMatchObject({ code: "authentication_required" });
  late.resolve({ privateData: "old owner" });
  await rejected;
  expect(attempts).toBe(2);
});

it("does not reauthenticate or retry a non-authentication failure", async () => {
  fake.request.mockRejectedValueOnce(new MiniError("network_error"));
  await expect(request(path, options)).rejects.toMatchObject({ code: "network_error" });
  expect(fake.request.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
  expect(fake.code).toHaveBeenCalledOnce();
});
