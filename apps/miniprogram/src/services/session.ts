import Taro from "@tarojs/taro";
import { createSessionManager } from "./session-manager";
import { apiOrigin, rawRequest, type RequestOptions } from "./http";
import { MiniError } from "./errors";

export const session = createSessionManager({
  code: async () => {
    apiOrigin();
    return (await Taro.login()).code;
  },
  request: rawRequest,
  remembered: () => Taro.getStorageSync<unknown>("seen-said:remember-login") === true,
  remember: (value) => Taro.setStorageSync("seen-said:remember-login", value),
});
export async function request(
  path: string,
  options: Omit<RequestOptions, "token"> = {},
): Promise<unknown> {
  const token = await session.ensure();
  const epoch = session.getSnapshot().epoch;
  let data: unknown;
  try {
    data = await rawRequest(path, { ...options, token });
  } catch (error) {
    if (session.getSnapshot().epoch !== epoch) throw new MiniError("authentication_required");
    if (!(error instanceof MiniError) || error.code !== "authentication_required") throw error;
    session.invalidate(token);
    const renewed = await session.ensure();
    const freshEpoch = session.getSnapshot().epoch;
    const retried = await rawRequest(path, { ...options, token: renewed });
    if (freshEpoch !== session.getSnapshot().epoch) throw new MiniError("authentication_required");
    return retried;
  }
  if (session.getSnapshot().epoch !== epoch) throw new MiniError("authentication_required");
  return data;
}
export function ownerId() {
  const account = session.getSnapshot().account;
  if (!account) throw new MiniError("authentication_required");
  return account.id;
}
