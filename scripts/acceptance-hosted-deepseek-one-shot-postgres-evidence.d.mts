export interface HostedDeepSeekPostgresEvidence {
  readServerSettlement(
    identity: unknown,
    control: unknown,
    operationLease: unknown,
  ): Promise<unknown>;
  reconcileDispatchedRequest(command: unknown, control?: unknown): Promise<unknown>;
}

export function createHostedDeepSeekPostgresEvidence(input: {
  query: (text: string, parameters: unknown[], control?: unknown) => Promise<{ rows: unknown[] }>;
}): HostedDeepSeekPostgresEvidence;
