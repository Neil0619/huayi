import type { CloudIdentityApi } from "./cloud-identity-api.js";
import type { ExtensionSessionVault } from "./extension-session-vault.js";

type CloudSessionState =
  | { readonly expiresAt: string; readonly status: "connected" | "pairing" }
  | { readonly status: "disconnected" | "expired" | "not-configured" };

interface CloudSessionManagerOptions {
  readonly api: CloudIdentityApi | null;
  readonly clearSubmissions: () => Promise<void>;
  readonly crypto: Crypto;
  readonly open: (url: string) => Promise<void>;
  readonly now?: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly vault: ExtensionSessionVault;
  readonly webOrigin: string | null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function sha256(crypto: Crypto, value: string): Promise<string> {
  return base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  );
}

function releaseOrigin(value: string | null): URL | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createCloudSessionManager(options: CloudSessionManagerOptions) {
  const now = options.now ?? Date.now;
  const configured = () => {
    const webOrigin = releaseOrigin(options.webOrigin);
    return options.api === null || webOrigin === null ? null : { api: options.api, webOrigin };
  };
  const status = async (): Promise<CloudSessionState> => {
    if (configured() === null) return { status: "not-configured" };
    const session = await options.vault.readSession();
    if (session !== null) {
      if (Date.parse(session.expiresAt) > now()) {
        return { expiresAt: session.expiresAt, status: "connected" };
      }
      await options.vault.clearSession();
      await options.clearSubmissions();
      return { status: "expired" };
    }
    const pending = await options.vault.readPending();
    if (pending === null) return { status: "disconnected" };
    if (Date.parse(pending.expiresAt) <= now()) {
      await options.vault.clearPending();
      return { status: "expired" };
    }
    return { expiresAt: pending.expiresAt, status: "pairing" };
  };
  return {
    async continuePairing(): Promise<CloudSessionState> {
      const dependencies = configured();
      if (dependencies === null) return { status: "not-configured" };
      const pending = await options.vault.readPending();
      if (pending === null) return status();
      if (Date.parse(pending.expiresAt) <= now()) {
        await options.vault.clearPending();
        return { status: "expired" };
      }
      const pairing = await dependencies.api.getPairing(pending.id);
      if (pairing.status === "pending") return { expiresAt: pairing.expiresAt, status: "pairing" };
      if (pairing.status === "expired") {
        await options.vault.clearPending();
        return { status: "expired" };
      }
      const exchanged = await dependencies.api.exchangePairing(pending.id, {
        pkceVerifier: pending.verifier,
        state: pending.state,
      });
      await options.clearSubmissions();
      await options.vault.writeSession({
        expiresAt: exchanged.expiresAt,
        preferences: exchanged.preferences,
        token: exchanged.sessionToken,
      });
      await options.vault.clearPending();
      return { expiresAt: exchanged.expiresAt, status: "connected" };
    },
    async disconnect(): Promise<CloudSessionState> {
      const session = await options.vault.readSession();
      if (session !== null) {
        const dependencies = configured();
        if (dependencies === null) throw new TypeError("Cloud disconnect is not configured.");
        await dependencies.api.disconnectExtensionSession(session.token);
      }
      await Promise.all([
        options.clearSubmissions(),
        options.vault.clearPending(),
        options.vault.clearSession(),
      ]);
      return { status: "disconnected" };
    },
    async start(): Promise<CloudSessionState> {
      const dependencies = configured();
      if (dependencies === null) return { status: "not-configured" };
      const verifier = base64Url(options.randomBytes(32));
      const state = base64Url(options.randomBytes(32));
      const installId = await options.vault.getOrCreateInstallId();
      const pairing = await dependencies.api.createPairing({
        installIdHash: await sha256(options.crypto, installId),
        pkceChallenge: await sha256(options.crypto, verifier),
        state,
      });
      const trustedPairingPath = `/pair-extension/${pairing.id}`;
      if (pairing.status !== "pending" || pairing.pairingPath !== trustedPairingPath) {
        throw new TypeError("Pairing response is inconsistent.");
      }
      await options.vault.writePending({
        expiresAt: pairing.expiresAt,
        id: pairing.id,
        pairingPath: pairing.pairingPath,
        state,
        verifier,
      });
      await options.open(new URL(trustedPairingPath, dependencies.webOrigin).toString());
      return { expiresAt: pairing.expiresAt, status: "pairing" };
    },
    status,
  };
}

export type CloudSessionManager = ReturnType<typeof createCloudSessionManager>;
