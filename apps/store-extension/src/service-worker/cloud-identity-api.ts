import {
  apiErrorSchema,
  createExtensionPairingRequestSchema,
  exchangeExtensionPairingRequestSchema,
  extensionPairingResponseSchema,
  extensionPairingExchangeResponseSchema,
  extensionPreferencesResponseSchema,
  identityHttpRoutes,
  type ApiError,
} from "@huayi/cloud-contracts";

import { extensionSessionHeaders } from "../cloud/extension-session-headers.js";

export class CloudIdentityApiError extends Error {
  constructor(
    readonly code: ApiError["error"]["code"] | "unknown",
    readonly status: number,
  ) {
    super(`Cloud identity request failed with ${status}.`);
    this.name = "CloudIdentityApiError";
  }
}

interface CloudIdentityApiOptions {
  readonly apiOrigin: string;
  readonly clientVersion: string;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function pairingPath(route: string, id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new TypeError("Pairing ID is invalid.");
  return route.replace(":id", encodeURIComponent(id));
}

export function createCloudIdentityApi(options: CloudIdentityApiOptions) {
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await options.fetch(new URL(path, options.apiOrigin), init);
    if (response.ok) return response;
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    throw new CloudIdentityApiError(
      parsed.success ? parsed.data.error.code : "unknown",
      response.status,
    );
  };
  return {
    async createPairing(input: unknown) {
      const response = await request(identityHttpRoutes.extensionPairingCreate, {
        body: JSON.stringify(createExtensionPairingRequestSchema.parse(input)),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return extensionPairingResponseSchema.parse(await response.json());
    },
    async disconnectExtensionSession(sessionToken: string) {
      await request(identityHttpRoutes.extensionSessionCurrent, {
        credentials: "omit",
        headers: extensionSessionHeaders(sessionToken, options.clientVersion),
        method: "DELETE",
      });
    },
    async exchangePairing(id: string, input: unknown) {
      const response = await request(pairingPath(identityHttpRoutes.extensionPairingExchange, id), {
        body: JSON.stringify(exchangeExtensionPairingRequestSchema.parse(input)),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return extensionPairingExchangeResponseSchema.parse(await response.json());
    },
    async getExtensionPreferences(sessionToken: string) {
      const response = await request(identityHttpRoutes.extensionPreferences, {
        credentials: "omit",
        headers: {
          Accept: "application/json",
          ...extensionSessionHeaders(sessionToken, options.clientVersion),
        },
      });
      return extensionPreferencesResponseSchema.parse(await response.json());
    },
    async getPairing(id: string) {
      const response = await request(pairingPath(identityHttpRoutes.extensionPairing, id), {
        headers: { Accept: "application/json" },
      });
      return extensionPairingResponseSchema.parse(await response.json());
    },
  };
}

export type CloudIdentityApi = ReturnType<typeof createCloudIdentityApi>;
