import Taro from "@tarojs/taro";
import { apiErrorSchema } from "@huayi/cloud-contracts";
import { MiniError } from "./errors";

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  data?: unknown;
  headers?: Record<string, string>;
  token?: string;
}
export function apiOrigin() {
  if (!MINIPROGRAM_API_ORIGIN) throw new MiniError("configuration_required");
  return MINIPROGRAM_API_ORIGIN;
}
export async function rawRequest(path: string, options: RequestOptions = {}): Promise<unknown> {
  if (!path.startsWith("/v1/") && !path.startsWith("/v2/")) throw new MiniError("forbidden");
  const url = apiOrigin() + path;
  try {
    const response = await Taro.request<unknown>({
      url,
      method: options.method ?? "GET",
      timeout: 30_000,
      ...(options.data === undefined ? {} : { data: JSON.stringify(options.data) }),
      header: {
        "Content-Type": "application/json",
        ...options.headers,
        ...(options.token ? { Authorization: `HuayiMiniProgram ${options.token}` } : {}),
      },
    });
    if (response.statusCode >= 200 && response.statusCode < 300) return response.data;
    const parsed = apiErrorSchema.safeParse(response.data);
    throw new MiniError(
      parsed.success
        ? parsed.data.error.code
        : response.statusCode === 401
          ? "authentication_required"
          : "network_error",
    );
  } catch (error) {
    if (error instanceof MiniError) throw error;
    throw new MiniError("network_error");
  }
}
