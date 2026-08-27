export const hostedDeepSeekAnalysisStreamPath: string;
export const hostedDeepSeekOneShotConfirmation: string;
export const hostedDeepSeekPayloadDigest: string;
export const hostedDeepSeekWebOrigin: string;
export const hostedDeepSeekWebPath: string;

export interface HostedDeepSeekOneShotExecutor {
  execute(approval: unknown): Promise<unknown>;
  recover(): Promise<unknown>;
  status(): Promise<unknown>;
}

export function createHostedDeepSeekOneShotExecutor(
  dependencies: unknown,
): HostedDeepSeekOneShotExecutor;
