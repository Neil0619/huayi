import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import { expect, it, vi } from "vitest";
import { AdminErrorLogsPage } from "./admin-error-logs-page.js";
import { WebIdentityApiError } from "./identity-api.js";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const record = {
  userId: "71000000-0000-4000-8000-000000000001",
  receivedAt: "2026-09-07T00:00:00.000Z",
  event: {
    version: 1 as const,
    id: "71000000-0000-4000-8000-000000000002",
    occurredAt: "2026-09-07T00:00:00.000Z",
    source: "store" as const,
    severity: "error" as const,
    operation: "instant-query" as const,
    code: "provider-error" as const,
    stage: "http" as const,
    httpStatus: 429,
    requestId: "71000000-0000-4000-8000-000000000003",
  },
};
const response = {
  items: [record],
  nextCursor: null,
  summary: { events: 3, errors: 2, affectedUsers: 1, affectedRequests: 1, groups: [] },
};
let root: Root;
let container: HTMLDivElement;
async function renderPage(props: Parameters<typeof AdminErrorLogsPage>[0]) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<AdminErrorLogsPage {...props} />));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});
it("shows aggregated failures, trace details and applies filters", async () => {
  const list = vi.fn(async () => response);
  await renderPage({ api: { listErrorLogs: list }, access: async () => undefined });
  expect(container.textContent).toContain("provider-error");
  expect(container.textContent).toContain("429");
  expect(container.textContent).toContain(record.event.requestId);
  const select = container.querySelector<HTMLSelectElement>("[aria-label='来源']");
  const form = container.querySelector("form");
  if (!select || !form) throw new Error("Missing log filters.");
  await act(async () => {
    select.value = "store";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ source: "store" }));
});
it("does not fetch private logs when operator authentication is denied", async () => {
  const listErrorLogs = vi.fn();
  await renderPage({
    api: { listErrorLogs },
    access: async () => {
      throw new WebIdentityApiError("forbidden", 403);
    },
  });
  expect(container.textContent).toContain("没有查看报错日志的权限");
  expect(listErrorLogs).not.toHaveBeenCalled();
  expect(container.querySelector("input[type='password']")).toBeNull();
});
it.each([
  ["forbidden", 403],
  ["authentication_required", 401],
] as const)("removes already displayed logs after %s", async (code, status) => {
  const access = vi.fn(async () => undefined);
  await renderPage({ api: { listErrorLogs: async () => response }, access });
  expect(container.textContent).toContain("provider-error");
  access.mockRejectedValueOnce(new WebIdentityApiError(code, status));
  const refresh = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "刷新",
  );
  if (!refresh) throw new Error("Missing refresh button.");
  await act(async () => refresh.click());
  expect(container.textContent).toContain("没有查看报错日志的权限");
  expect(container.textContent).not.toContain("provider-error");
});

it("immediately denies a forbidden log read even if access just succeeded", async () => {
  await renderPage({
    access: async () => undefined,
    api: {
      listErrorLogs: async () => {
        throw new WebIdentityApiError("forbidden", 403);
      },
    },
  });
  expect(container.textContent).toContain("没有查看报错日志的权限");
  expect(container.querySelector("input[type='password']")).toBeNull();
});
