declare const HUAYI_CLOUD_API_ORIGIN_BUILD_VALUE: string | null | undefined;
declare const HUAYI_WEB_WORKSPACE_URL_BUILD_VALUE: string | null | undefined;
declare const HUAYI_WEB_ORIGIN_BUILD_VALUE: string | null | undefined;

export const HUAYI_CLOUD_API_ORIGIN: string | null =
  typeof HUAYI_CLOUD_API_ORIGIN_BUILD_VALUE === "undefined"
    ? null
    : HUAYI_CLOUD_API_ORIGIN_BUILD_VALUE;
export const HUAYI_WEB_WORKSPACE_URL: string | null =
  typeof HUAYI_WEB_WORKSPACE_URL_BUILD_VALUE === "undefined"
    ? null
    : HUAYI_WEB_WORKSPACE_URL_BUILD_VALUE;
export const HUAYI_WEB_ORIGIN: string | null =
  typeof HUAYI_WEB_ORIGIN_BUILD_VALUE === "undefined" ? null : HUAYI_WEB_ORIGIN_BUILD_VALUE;
