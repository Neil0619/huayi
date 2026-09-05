import { afterAll } from "vitest";

// Node 26 defines Storage globals that Vitest 3 leaves in place. Use the current
// jsdom window so browser events and storage share the same realm and lifetime.
const { jsdom } = globalThis as typeof globalThis & {
  jsdom: { window: Pick<Window, "localStorage" | "sessionStorage"> };
};

for (const name of ["localStorage", "sessionStorage"] as const) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => jsdom.window[name],
  });
  afterAll(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  });
}
