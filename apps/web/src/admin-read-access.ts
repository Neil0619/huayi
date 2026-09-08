import { useMemo } from "react";
import type { WebAdminOperationsApi } from "./admin-operations-api.js";
import { WebIdentityApiError } from "./identity-api.js";

export function useAdminReadAccess(api: WebAdminOperationsApi, onDenied: () => void) {
  return useMemo(() => {
    const read = async <T>(operation: Promise<T>): Promise<T> => {
      try {
        return await operation;
      } catch (error) {
        if (
          error instanceof WebIdentityApiError &&
          (error.code === "forbidden" || error.code === "authentication_required")
        )
          onDenied();
        throw error;
      }
    };
    return {
      ...api,
      access: () => read(api.access()),
      getUsage: () => read(api.getUsage()),
      listUsers: (...args: Parameters<typeof api.listUsers>) => read(api.listUsers(...args)),
      listInvitations: (...args: Parameters<typeof api.listInvitations>) =>
        read(api.listInvitations(...args)),
      listAuditEvents: (...args: Parameters<typeof api.listAuditEvents>) =>
        read(api.listAuditEvents(...args)),
    };
  }, [api, onDenied]);
}
