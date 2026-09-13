import {
  createLearningTaskClient,
  createStructuredLearningTaskClient,
  type LearningTaskTransport,
} from "@huayi/cloud-contracts";

interface Options {
  apiOrigin: string;
  csrfToken(): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

function transport(options: Options): LearningTaskTransport {
  return {
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
  };
}

export const createWebLearningTasks = (options: Options) =>
  createLearningTaskClient(transport(options));
export const createWebStructuredLearningTasks = (options: Options) =>
  createStructuredLearningTaskClient(transport(options));
