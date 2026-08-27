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

export function createHostedAcceptanceHmacKeyring(input: {
  activeVersion: number;
  keys: Map<number, Uint8Array>;
}): HostedAcceptanceHmacKeyring;
