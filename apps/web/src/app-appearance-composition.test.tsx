import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth-page.js", () => ({
  AuthPage: () => <main>认证页面</main>,
}));
vi.mock("./cloud-app.js", () => ({
  CloudApp: ({ page, pairingId }: { page?: string; pairingId?: string }) => (
    <main>{pairingId === undefined ? `Cloud ${page ?? "inbox"}` : "配对页面"}</main>
  ),
}));
vi.mock("./privacy-page.js", () => ({
  PrivacyPage: () => <main>公共页面</main>,
}));

import { App } from "./app.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  delete document.documentElement.dataset.appearance;
});

async function render(surface: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => createRoot(container).render(surface));
  return container;
}

describe("App appearance composition", () => {
  it("uses one appearance controller for public, auth, workspace, Admin, and pairing surfaces", async () => {
    const identity = {} as Parameters<typeof App>[0]["identity"];
    const surfaces = [
      { content: "公共页面", element: <App publicPage="privacy" /> },
      {
        content: "认证页面",
        element: <App authRoute={{ mode: "login" }} identity={identity} />,
      },
      { content: "Cloud practice", element: <App identity={identity} page="practice" /> },
      { content: "Cloud admin", element: <App identity={identity} page="admin" /> },
      { content: "配对页面", element: <App identity={identity} pairingId="pairing-1" /> },
    ];

    for (const surface of surfaces) {
      const container = await render(surface.element);
      expect(container.textContent).toContain(surface.content);
      expect(container.querySelectorAll("fieldset.appearance-selector")).toHaveLength(1);
      expect(container.querySelectorAll("legend")[0]?.textContent).toBe("外观");
      container.remove();
    }
  });
});
