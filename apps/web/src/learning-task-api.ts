import { createLearningTaskClient } from "@huayi/cloud-contracts";

export function createWebLearningTasks(options: {
  apiOrigin: string;
  csrfToken(): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}) {
  return createLearningTaskClient({
    async request(path, init) {
      return options.fetch(new URL(path, options.apiOrigin), {
        ...init,
        credentials: "include",
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          ...(init.method === "POST" ? { "X-CSRF-Token": await options.csrfToken() } : {}),
        },
      });
    },
  });
}
