import type { SignInMethod } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import type { AccountStatus } from "./identity-state.js";
import type { Clock } from "./security.js";

export function createInMemorySignInMethods(options: {
  clock: Clock;
  profiles: ReadonlyMap<string, AccountStatus>;
}) {
  const methodsByUser = new Map<string, Map<SignInMethod, Date>>();
  const order: Record<SignInMethod, number> = { password: 0, google: 1 };

  return {
    authorizeSignInMethod(userId: string, method: SignInMethod) {
      const status = options.profiles.get(userId);
      if (
        (status !== "active" && status !== "disabled") ||
        !methodsByUser.get(userId)?.has(method)
      ) {
        throw new CloudFault("authentication_required", "The sign-in method is not authorized.");
      }
      return { userId };
    },
    listSignInMethods(userId: string) {
      return [...(methodsByUser.get(userId)?.entries() ?? [])]
        .map(([method, linkedAt]) => ({ linkedAt, method }))
        .sort((left, right) => order[left.method] - order[right.method]);
    },
    registerSignInMethods(userId: string, methods: readonly SignInMethod[]) {
      const registered = methodsByUser.get(userId) ?? new Map<SignInMethod, Date>();
      for (const method of methods) {
        if (!registered.has(method)) registered.set(method, options.clock.now());
      }
      methodsByUser.set(userId, registered);
    },
  };
}
