export const hostedAcceptanceHmacContext: string;

export interface HostedAcceptanceHmacMaterial {
  readonly context: string;
  readonly idempotencyKey: string;
  readonly verifier: string;
  readonly version: number;
}

export interface HostedAcceptanceHmacKeyring {
  create(operationId: string): HostedAcceptanceHmacMaterial;
  recover(input: {
    context: string;
    operationId: string;
    verifier: string;
    version: number;
  }): HostedAcceptanceHmacMaterial;
}

export interface HostedDeepSeekPostgresAuthority {
  armCleanup(command: unknown): Promise<unknown>;
  bindRequest(command: unknown, control?: unknown): Promise<unknown>;
  claimCleanup(): Promise<unknown>;
  claimOperation(command: unknown): Promise<unknown>;
  completeCleanup(command: unknown): Promise<unknown>;
  completeOperation(command: unknown): Promise<unknown>;
  markDispatchAttempted(command: unknown, control?: unknown): Promise<unknown>;
  readStatus(control?: unknown): Promise<unknown>;
  recordSettlement(command: unknown, control?: unknown): Promise<unknown>;
  retain(maximumRows?: number): Promise<unknown>;
}

export function createHostedAcceptanceHmacKeyring(input: {
  activeVersion: number;
  keys: Map<number, Uint8Array>;
}): HostedAcceptanceHmacKeyring;

export function createHostedDeepSeekPostgresAuthority(input: {
  keyring: HostedAcceptanceHmacKeyring;
  query: (text: string, parameters: unknown[], control?: unknown) => Promise<{ rows: unknown[] }>;
  randomBytes_?: (size: number) => Uint8Array;
  randomUUID_?: () => string;
}): HostedDeepSeekPostgresAuthority;
