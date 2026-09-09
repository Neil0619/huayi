import type {
  MiniProgramAccount,
  MiniProgramLogin,
  MiniProgramSession,
} from "@huayi/cloud-contracts";

import type { WechatProof } from "./wechat-provider.js";

export interface MiniProgramAuthentication {
  userId: string;
  reauthenticatedAt: Date;
  sessionHash: string;
}
export interface MiniProgramIdentity {
  begin(proof: WechatProof): Promise<MiniProgramLogin>;
  onboard(ticket: string, mode: "independent" | "linked"): Promise<MiniProgramSession>;
  bindingStatus(ticket: string): Promise<{ status: "pending" | "approved" | "expired" }>;
  approveBinding(code: string, webSessionHash: string, userId: string): Promise<void>;
  authenticate(token: string): Promise<MiniProgramAuthentication>;
  reauthenticate(token: string, proof: WechatProof): Promise<void>;
  revoke(token: string): Promise<void>;
  account(userId: string): Promise<MiniProgramAccount>;
}
