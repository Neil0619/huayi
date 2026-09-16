import { z } from "zod/v3";

const backfillErrorCodeSchema = z.enum([
  "unavailable",
  "connection",
  "authentication",
  "request-failed",
  "permission",
]);
export type BackfillErrorCode = z.infer<typeof backfillErrorCodeSchema>;
const messages: Record<BackfillErrorCode, string> = {
  unavailable: "扇贝回填服务暂未就绪，请稍后重试。",
  connection: "无法连接回填服务，请检查网络后重试。",
  authentication: "账号连接已失效，请在设置中重新连接后重试。",
  "request-failed": "操作未完成，请刷新回填状态后重试。",
  permission: "请先在设置中允许扇贝回填，并启用扇贝网站。",
};

export const backfillErrorResponseSchema = z.strictObject({
  code: backfillErrorCodeSchema,
  error: z.string().max(300),
});

export class BackfillError extends Error {
  constructor(readonly code: BackfillErrorCode) {
    super(messages[code]);
  }
}

export function backfillErrorResponse(error: unknown) {
  const code = error instanceof BackfillError ? error.code : "request-failed";
  return { code, error: messages[code] };
}
