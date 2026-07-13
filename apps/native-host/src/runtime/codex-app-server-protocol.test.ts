import { describe, expect, it } from "vitest";

import { isInertMcpResponse, isSafeHooksResponse } from "./codex-app-server-protocol.js";

const workingDirectory = "/tmp/huayi-empty";
const safeHook = {
  cwd: workingDirectory,
  errors: [],
  hooks: [],
  warnings: [],
};
const inertMcp = {
  authStatus: "unsupported",
  name: "node_repl",
  resourceTemplates: [],
  resources: [],
  serverInfo: null,
  tools: {},
};

function withoutField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

describe("isSafeHooksResponse", () => {
  it("accepts the observed safe Hook record", () => {
    expect(isSafeHooksResponse({ data: [safeHook] }, workingDirectory)).toBe(true);
  });

  it("preserves compatibility with an empty Hook response", () => {
    expect(isSafeHooksResponse({ data: [] }, workingDirectory)).toBe(true);
  });

  it.each([
    ["a different working directory", { ...safeHook, cwd: "/Users/tester/project" }],
    ["configured hooks", { ...safeHook, hooks: [{}] }],
    ["warnings", { ...safeHook, warnings: ["warning"] }],
    ["errors", { ...safeHook, errors: ["error"] }],
    ["an unknown field", { ...safeHook, unknown: true }],
  ])("rejects a Hook record with %s", (_name, record) => {
    expect(isSafeHooksResponse({ data: [record] }, workingDirectory)).toBe(false);
  });

  it("rejects non-object Hook records", () => {
    expect(isSafeHooksResponse({ data: [null] }, workingDirectory)).toBe(false);
  });

  it.each([
    ["cwd", { errors: [], hooks: [], warnings: [] }],
    ["errors", { cwd: workingDirectory, hooks: [], warnings: [] }],
    ["hooks", { cwd: workingDirectory, errors: [], warnings: [] }],
    ["warnings", { cwd: workingDirectory, errors: [], hooks: [] }],
  ])("rejects a Hook record missing %s", (_field, record) => {
    expect(isSafeHooksResponse({ data: [record] }, workingDirectory)).toBe(false);
  });

  it("rejects unknown Hook response fields", () => {
    expect(isSafeHooksResponse({ data: [], nextCursor: null }, workingDirectory)).toBe(false);
  });
});

describe("isInertMcpResponse", () => {
  it("accepts the observed inert MCP status record", () => {
    expect(isInertMcpResponse({ data: [inertMcp], nextCursor: null })).toBe(true);
  });

  it("preserves compatibility with an empty MCP response", () => {
    expect(isInertMcpResponse({ data: [], nextCursor: null })).toBe(true);
  });

  it.each([
    ["active server information", { ...inertMcp, serverInfo: { name: "active" } }],
    ["tools", { ...inertMcp, tools: { run: {} } }],
    ["resources", { ...inertMcp, resources: [{}] }],
    ["resource templates", { ...inertMcp, resourceTemplates: [{}] }],
    ["an undefined serverInfo", { ...inertMcp, serverInfo: undefined }],
    ["an empty name", { ...inertMcp, name: "" }],
    ["a non-string authStatus", { ...inertMcp, authStatus: null }],
    ["an unknown field", { ...inertMcp, unknown: true }],
  ])("rejects an MCP record with %s", (_name, record) => {
    expect(isInertMcpResponse({ data: [record], nextCursor: null })).toBe(false);
  });

  it("rejects non-object MCP records", () => {
    expect(isInertMcpResponse({ data: [null], nextCursor: null })).toBe(false);
  });

  it.each(["authStatus", "name", "resourceTemplates", "resources", "serverInfo", "tools"])(
    "rejects an MCP record missing %s",
    (field) => {
      expect(isInertMcpResponse({ data: [withoutField(inertMcp, field)], nextCursor: null })).toBe(
        false,
      );
    },
  );

  it("rejects unknown MCP response fields", () => {
    expect(isInertMcpResponse({ data: [], nextCursor: null, unknown: true })).toBe(false);
  });

  it("rejects a non-null MCP nextCursor", () => {
    expect(isInertMcpResponse({ data: [], nextCursor: "next" })).toBe(false);
  });
});
