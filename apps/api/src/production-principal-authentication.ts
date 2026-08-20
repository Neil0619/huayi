import { CloudFault } from "./cloud-fault.js";

export interface ProductionIdentityAuthentication {
  authenticateExtension(token: string): Promise<{ userId: string }>;
  authenticateWebMutation(
    sessionId: string,
    origin: string,
    csrf: string,
  ): Promise<{ userId: string }>;
  authenticateWebSession(sessionId: string): Promise<{ userId: string }>;
}

export interface ExtensionRequestPolicy {
  readonly extensionOrigin: string;
  readonly minSupportedExtensionVersion: string;
}

export interface ProductionPrincipalHeaders {
  readonly authorization?: string;
  readonly clientVersion?: string;
  readonly cookie?: string;
  readonly csrf?: string;
  readonly method?: string;
  readonly origin?: string;
}

const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

function version(value: string): readonly [number, number, number] | null {
  if (!versionPattern.test(value)) return null;
  const parts = value.split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part))) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function supported(client: string | undefined, minimum: string): boolean {
  if (client === undefined) return false;
  const actual = version(client);
  const required = version(minimum);
  if (actual === null || required === null) return false;
  for (let index = 0; index < 3; index += 1) {
    const difference = (actual[index] ?? 0) - (required[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function extensionToken(authorization: string): string | null {
  const match = /^HuayiExtension ([^\s]{32,2048})$/u.exec(authorization);
  return match?.[1] ?? null;
}

export async function authenticateProductionAnalysisRequest(
  identity: ProductionIdentityAuthentication,
  headers: ProductionPrincipalHeaders,
  policy: ExtensionRequestPolicy,
): Promise<string> {
  return (await authenticateProductionPrincipalRequest(identity, headers, policy)).userId;
}

export async function authenticateProductionPrincipalRequest(
  identity: ProductionIdentityAuthentication,
  headers: ProductionPrincipalHeaders,
  policy: ExtensionRequestPolicy,
): Promise<{ kind: "extension" | "web"; userId: string }> {
  if (headers.authorization !== undefined) {
    const token = extensionToken(headers.authorization);
    if (token === null || headers.origin !== policy.extensionOrigin) {
      throw new CloudFault("forbidden", "Extension request proof is invalid.");
    }
    if (!supported(headers.clientVersion, policy.minSupportedExtensionVersion)) {
      throw new CloudFault("client_upgrade_required", "The Extension must be upgraded.");
    }
    return { kind: "extension", userId: (await identity.authenticateExtension(token)).userId };
  }
  const session = headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("huayi_session="))
    ?.slice("huayi_session=".length);
  if (session === undefined) {
    throw new CloudFault("authentication_required", "A session is required.");
  }
  if (headers.method !== undefined && headers.method !== "GET" && headers.method !== "HEAD") {
    if (headers.origin === undefined || headers.csrf === undefined) {
      throw new CloudFault("forbidden", "Origin and CSRF proof are required.");
    }
    return {
      kind: "web",
      userId: (await identity.authenticateWebMutation(session, headers.origin, headers.csrf))
        .userId,
    };
  }
  return { kind: "web", userId: (await identity.authenticateWebSession(session)).userId };
}
